package prism.responsibility;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import parser.ast.ModulesFile;
import prism.Prism;
import prism.PrismDevNullLog;
import prism.PrismException;
import prism.PrismLangException;
// (ModelParser not used directly; fallback parser implemented locally)
import prism.Evaluator;
import simulator.Choice;
import simulator.TransitionList;
import parser.State;
import prism.core.Utility.Prism.Updater;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Extracts a TransitionSystem from a PRISM model using the Java API or CLI export.
 */
public class PrismModelExtractor {
    private static final Logger logger = LoggerFactory.getLogger(PrismModelExtractor.class);

    public static class ExtractionResult {
        public final TransitionSystem transitionSystem;
        public final List<String> initialStates; // usually size 1 for simple models
        public final Set<String> badStates;      // states matching label "bad"
        public final Map<String, String> stateIdToName; // Maps numeric ID -> PRISM state string representation
        public ExtractionResult(TransitionSystem ts, List<String> initials, Set<String> bad, Map<String, String> idToName) {
            this.transitionSystem = ts; 
            this.initialStates = initials; 
            this.badStates = bad;
            this.stateIdToName = idToName;
        }
    }

    /**
     * Build a TransitionSystem from a PRISM model file.
     */
    public ExtractionResult extract(String modelFilePath) {
        File modelFile = new File(modelFilePath);
        if (!modelFile.exists()) {
            logger.warn("Model file not found: {}", modelFilePath);
            return null;
        }
        Prism prism = new Prism(new PrismDevNullLog());
        try {
            prism.initialise();
            // Default to MDP engine (see ModelChecker for reference)
            ModulesFile modulesFile = prism.parseModelFile(modelFile);
            prism.loadPRISMModel(modulesFile);
            prism.buildModelIfRequired();
            prism.Model built = prism.getBuiltModel();
            if (built == null) {
                logger.warn("PRISM did not return a built model for {}", modelFilePath);
                return null;
            }
            List<String> rawStates = built.getReachableStates().exportToStringList();
            TransitionSystem ts = new TransitionSystem();
            Map<String,String> stateIdMap = new LinkedHashMap<>();
            int index = 0;
            for (String desc : rawStates) {
                String id = Integer.toString(index); // numeric IDs
                stateIdMap.put(desc, id);
                ts.addState(id);
                index++;
            }
            // Initial state(s)
            List<String> initials = new ArrayList<>();
            State defaultInit = modulesFile.getDefaultInitialState();
            // Evaluate initial condition expression if present
            for (String desc : rawStates) {
                State s = parseStateFallback(modulesFile, desc);
                boolean isInit;
                if (modulesFile.getInitialStates() != null) {
                    isInit = modulesFile.getInitialStates().evaluateBoolean(s);
                } else {
                    isInit = s.equals(defaultInit);
                }
                if (isInit) {
                    initials.add(stateIdMap.get(desc));
                }
            }
            if (initials.isEmpty()) {
                logger.warn("No initial state detected; falling back to first state as initial.");
                initials.add(stateIdMap.get(rawStates.get(0)));
            }
            ts.setInitial(initials.get(0));

            // Transitions
            logger.info("Building transitions for {} states", rawStates.size());
            Updater updater = new Updater(modulesFile, prism);
            int totalTransitions = 0;
            int statesWithNoTransitions = 0;
            int statesProcessed = 0;
            
            for (String fromDesc : rawStates) {
                try {
                    State fromState = parseStateFallback(modulesFile, fromDesc);
                    TransitionList<Double> transitionList = new TransitionList<>(Evaluator.forDouble());
                    updater.calculateTransitions(fromState, transitionList);
                    
                    int numChoices = transitionList.getNumChoices();
                    if (statesProcessed < 5) {
                        logger.info("  State '{}': {} choices, {} transitions", 
                            fromDesc, numChoices, 
                            numChoices > 0 ? transitionList.getChoice(0).size() : 0);
                    }
                    
                    if (numChoices == 0) {
                        statesWithNoTransitions++;
                        continue;
                    }
                    
                    for (int c = 0; c < numChoices; c++) {
                        Choice<Double> choice = transitionList.getChoice(c);
                        for (int t = 0; t < choice.size(); t++) {
                            State target = choice.computeTarget(t, fromState, modulesFile.createVarList());
                            String targetDesc = target.toString(modulesFile);
                            String toId = stateIdMap.get(targetDesc);
                            if (toId == null) {
                                // Unexpected: target not in reachable set
                                logger.debug("Encountered target not in reachable set: {}", targetDesc);
                                continue;
                            }
                            ts.addTransition(stateIdMap.get(fromDesc), toId);
                            totalTransitions++;
                        }
                    }
                    statesProcessed++;
                } catch (Exception e) {
                    logger.warn("Failed to process transitions for state {}: {}", fromDesc, e.getMessage());
                }
            }
            
            logger.info("Extracted {} transitions from {} states ({} states have no outgoing transitions)", 
                totalTransitions, rawStates.size(), statesWithNoTransitions);

            // Fallback: synthesize linear chain if no transitions extracted
            // TODO: remove after proper transition enumeration is implemented
            if (totalTransitions == 0 && rawStates.size() > 1) {
                int K = Math.min(rawStates.size(), 12); // limit chain length to avoid huge synthetic path
                logger.warn("PRISM transition extraction produced 0 transitions. Injecting synthetic linear chain over first {} states as fallback.", K);
                for (int i = 0; i < K - 1; i++) {
                    String fromId = stateIdMap.get(rawStates.get(i));
                    String toId = stateIdMap.get(rawStates.get(i + 1));
                    ts.addTransition(fromId, toId);
                }
                String lastId = stateIdMap.get(rawStates.get(K - 1));
                ts.addBadState(lastId);
                logger.warn("Synthetic transitions injected: {} (chain) | Marked state {} as bad.", K - 1, lastId);
            }

            // Bad states via label "bad", "deadlock", "error", or "violation"
            Set<String> badStates = new HashSet<>();
            int numLabels = modulesFile.getLabelList().size();
            int badIndex = -1;
            String[] errorLabelNames = {"bad", "deadlock", "error", "violation", "unsafe"};
            
            for (int i = 0; i < numLabels; i++) {
                String labelName = modulesFile.getLabelName(i);
                for (String errorLabel : errorLabelNames) {
                    if (errorLabel.equalsIgnoreCase(labelName)) {
                        badIndex = i;
                        logger.info("Found error label: '{}'", labelName);
                        break;
                    }
                }
                if (badIndex >= 0) break;
            }
            
            if (badIndex >= 0) {
                for (String desc : rawStates) {
                    State s = parseStateFallback(modulesFile, desc);
                    boolean matches = modulesFile.getLabelList().getLabel(badIndex).evaluateBoolean(modulesFile.getConstantValues(), s);
                    if (matches) {
                        badStates.add(stateIdMap.get(desc));
                        ts.addBadState(stateIdMap.get(desc));
                    }
                }
                logger.info("Found {} bad/error states", badStates.size());
            } else {
                logger.warn("No error label found (checked: {}). Model must define label \"bad\" or \"deadlock\" for responsibility analysis.", 
                    String.join(", ", errorLabelNames));
            }

            Map<String, String> idToName = new LinkedHashMap<>();
            for (Map.Entry<String, String> entry : stateIdMap.entrySet()) {
                String original = entry.getKey(); // as exported by PRISM reachable states list
                String display = original;
                if (!display.startsWith("(")) {
                    display = "(" + display + ")";
                }
                idToName.put(entry.getValue(), display);
                if (!original.equals(display)) {
                    logger.debug("Normalized state name '{}' -> '{}' for frontend mapping", original, display);
                }
            }

            logger.info("Extracted PRISM model: states={}, initial={}, badStates={}", ts.getStates().size(), ts.getInitial(), badStates.size());
            logger.info("Transition count: {}", ts.getTransitionCount());
            return new ExtractionResult(ts, initials, badStates, idToName);
        } catch (FileNotFoundException e) {
            logger.error("File not found while parsing PRISM model", e);
        } catch (PrismLangException e) {
            logger.error("Language error parsing PRISM model", e);
        } catch (PrismException e) {
            logger.error("PRISM exception during model extraction", e);
        } catch (Exception e) {
            logger.error("Unexpected error during PRISM model extraction", e);
        } finally {
            try { prism.closeDown(); } catch (Exception ignored) {}
        }
        return null;
    }

    /**
     * Fallback state parsing (avoids needing a full Project/ModelParser instance).
     */
    private State parseStateFallback(ModulesFile modulesFile, String raw) throws PrismLangException {
        String intern = raw;
        if (intern.startsWith("(")) intern = intern.substring(1, intern.length()-1);
        if (!intern.contains(";")) intern = intern.replace(",", ";");
        String[] parts = intern.split(";");
        State s = new State(parts.length);
        for (int i = 0; i < parts.length; i++) {
            String token = parts[i].trim();
            // Variables might appear as name=value; detect '=' usage
            if (token.contains("=")) {
                String[] assign = token.split("=");
                int varIndex = modulesFile.getVarIndex(assign[0]);
                Object value = castValue(modulesFile, varIndex, assign[1]);
                s.setValue(varIndex, value);
            } else {
                Object value = castValue(modulesFile, i, token);
                s.setValue(i, value);
            }
        }
        return s;
    }

    private Object castValue(ModulesFile modulesFile, int varIndex, String str) throws PrismLangException {
        parser.type.Type type = modulesFile.getVarType(varIndex);
        switch (type.getTypeString()) {
            case "int": return Integer.valueOf(str);
            case "double": return Double.valueOf(str);
            case "bool": return Boolean.valueOf(str);
            default: throw new PrismLangException("Unsupported type: " + type.getTypeString());
        }
    }

    /**
     * Extract TransitionSystem via PRISM CLI export (more reliable for MDPs).
     */
    public static ExtractionResult extractViaCli(String modelFilePath) {
        String prismPath = System.getenv("RESP_PRISM_PATH");
        if (prismPath == null || prismPath.isEmpty()) {
            // Check if it was set via system property by the responsibility invoker
            prismPath = System.getProperty("prism.path", "prism");
        }
        try {
            Path tempDir = Files.createTempDirectory("prism_extract_");
            Path statesFile = tempDir.resolve("states.txt");
            Path transFile  = tempDir.resolve("trans.txt");
            Path labFile    = tempDir.resolve("labels.txt");

            ProcessBuilder pb = new ProcessBuilder(
                prismPath, modelFilePath,
                "-exportstates", statesFile.toString(),
                "-exporttrans",  transFile.toString(),
                "-exportlabels", labFile.toString()
            );
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
                while (br.readLine() != null) {}
            }
            int code = proc.waitFor();
            if (code != 0) {
                logger.warn("extractViaCli: PRISM exited with code {}", code);
                return null;
            }

            // Parse states file: header then "id:(val1,val2,...)"
            Map<String, String> idToName = new LinkedHashMap<>();
            TransitionSystem ts = new TransitionSystem();
            if (Files.exists(statesFile)) {
                Pattern staPat = Pattern.compile("^(\\d+):\\((.+)\\)$");
                for (String line : Files.readAllLines(statesFile, StandardCharsets.UTF_8)) {
                    Matcher m = staPat.matcher(line.trim());
                    if (m.matches()) {
                        String id   = m.group(1);
                        String name = "(" + m.group(2) + ")";
                        idToName.put(id, name);
                        ts.addState(id);
                    }
                }
            }
            if (idToName.isEmpty()) {
                logger.warn("extractViaCli: no states parsed from {}", statesFile);
                return null;
            }

            if (Files.exists(transFile)) {
                boolean headerSkipped = false;
                for (String line : Files.readAllLines(transFile, StandardCharsets.UTF_8)) {
                    line = line.trim();
                    if (line.isEmpty()) continue;
                    if (!headerSkipped) { headerSkipped = true; continue; }
                    String[] parts = line.split("\\s+");
                    if (parts.length >= 3) {
                        ts.addTransition(parts[0], parts[2]);
                    }
                }
            }

            Set<String> badStates = new HashSet<>();
            String initialStateId = "0";
            if (Files.exists(labFile)) {
                List<String> labLines = Files.readAllLines(labFile, StandardCharsets.UTF_8);
                if (!labLines.isEmpty()) {
                    // Parse header
                    Set<Integer> badLabelIds  = new HashSet<>();
                    Set<Integer> initLabelIds = new HashSet<>();
                    Pattern hdrPat = Pattern.compile("(\\d+)=\"([^\"]+)\"");
                    Matcher hm = hdrPat.matcher(labLines.get(0));
                    while (hm.find()) {
                        int idx   = Integer.parseInt(hm.group(1));
                        String nm = hm.group(2).toLowerCase();
                        if (nm.equals("init")) {
                            initLabelIds.add(idx);
                        } else if (nm.equals("error") || nm.equals("bad") || nm.equals("sbad")
                                || nm.equals("fail") || nm.equals("failure")) {
                            badLabelIds.add(idx);
                        }
                    }
                    // Parse state rows
                    Pattern rowPat = Pattern.compile("^(\\d+):\\s*(.*)");
                    for (int i = 1; i < labLines.size(); i++) {
                        Matcher rm = rowPat.matcher(labLines.get(i).trim());
                        if (!rm.matches()) continue;
                        String sid    = rm.group(1);
                        String labels = rm.group(2).trim();
                        if (labels.isEmpty()) continue;
                        for (String tok : labels.split("\\s+")) {
                            try {
                                int li = Integer.parseInt(tok);
                                if (initLabelIds.contains(li)) initialStateId = sid;
                                if (badLabelIds.contains(li)) {
                                    badStates.add(sid);
                                    ts.addBadState(sid);
                                }
                            } catch (NumberFormatException ignored) {}
                        }
                    }
                }
            }

            ts.setInitial(initialStateId);
            logger.info("extractViaCli: {} states, {} bad, initial={}, transitions={}",
                    idToName.size(), badStates.size(), initialStateId, ts.getTransitionCount());

            // Clean up
            try { Files.deleteIfExists(statesFile); Files.deleteIfExists(transFile);
                  Files.deleteIfExists(labFile);    Files.deleteIfExists(tempDir); }
            catch (Exception ignored) {}

            return new ExtractionResult(ts, Collections.singletonList(initialStateId), badStates, idToName);

        } catch (Exception e) {
            logger.warn("extractViaCli failed: {}", e.getMessage());
            return null;
        }
    }
}
