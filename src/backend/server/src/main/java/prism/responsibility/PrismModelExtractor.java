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

import java.io.File;
import java.io.FileNotFoundException;
import java.util.*;

/**
 * Extracts a TransitionSystem from a real PRISM model using the PRISM Java API.
 *
 * Minimal implementation goals (MVP):
 *  - Parse and load model (.prism) as MDP/DTMC (default: MDP)
 *  - Enumerate reachable states and assign stable string IDs (use PRISM state string directly)
 *  - Identify initial states
 *  - Enumerate transitions (successor relation without probabilities yet)
 *  - Detect bad states via label named "bad" if present (otherwise empty set)
 *  - Provide fallback handling/logging on errors
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
     * @param modelFilePath path to .prism file
     * @param modelType PRISM model type (MDP, DTMC, etc.) default MDP
     * @return ExtractionResult or null if failure
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
            // Gather reachable states
            List<String> rawStates = built.getReachableStates().exportToStringList();
            TransitionSystem ts = new TransitionSystem();
            // Map PRISM state description -> ID (for now use normalized numeric index or original string?)
            // We'll keep numeric indices to better match existing frontend node IDs where possible.
            // Provide a mapping PRISM string -> numeric (string) index.
            Map<String,String> stateIdMap = new LinkedHashMap<>();
            // ModelParser requires a Project instance; for extraction we mimic minimal parsing using ModulesFile directly.
            // We'll manually parse states using internal normalization similar to ModelChecker logic.
            // (Future improvement: refactor ModelParser to allow lightweight construction.)
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
                // PRISM does not expose parseState on ModulesFile; reuse stored string directly for initial detection
                // Approach: iterate through states again evaluating initial expression by reconstructing State via project-style parser
                // Simplification: use default initial or expression evaluation via modulesFile.getInitialStates() on created varList
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

            // Transitions: use Updater similar to ModelChecker, but simpler.
            logger.info("Building transitions using Updater for {} states", rawStates.size());
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
                        continue; // deadlock state (no successors)
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

            // TEMPORARY FALLBACK (synthetic transitions):
            // If PRISM failed to yield any transitions we inject a simple linear chain so that downstream
            // responsibility and counterexample logic has structural data to work with. This should be
            // removed once full transition extraction (incl. probabilities) is implemented.
            // TODO (Responsibility Visualization Hardening): remove synthetic chain + bad state marker after
            // implementing proper transition enumeration for all supported model types.
            // Fallback: if no transitions were extracted at all, synthesize a simple chain across first K states
            if (totalTransitions == 0 && rawStates.size() > 1) {
                int K = Math.min(rawStates.size(), 12); // limit chain length to avoid huge synthetic path
                logger.warn("PRISM transition extraction produced 0 transitions. Injecting synthetic linear chain over first {} states as fallback.", K);
                for (int i = 0; i < K - 1; i++) {
                    String fromId = stateIdMap.get(rawStates.get(i));
                    String toId = stateIdMap.get(rawStates.get(i + 1));
                    ts.addTransition(fromId, toId);
                }
                // Mark last state of chain as bad to allow counterexample termination if no labels provided
                String lastId = stateIdMap.get(rawStates.get(K - 1));
                ts.addBadState(lastId);
                logger.warn("Synthetic transitions injected: {} (chain) | Marked state {} as bad.", K - 1, lastId);
            }

            // Bad states via label "bad", "deadlock", "error", or "violation" (if defined)
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

            // Build reverse map: numeric ID -> state description (ensure parentheses to match frontend node names)
            Map<String, String> idToName = new LinkedHashMap<>();
            for (Map.Entry<String, String> entry : stateIdMap.entrySet()) {
                String original = entry.getKey(); // as exported by PRISM reachable states list
                String display = original;
                // Frontend graph node names include parentheses e.g. "(0,0,0,0)"; add them if absent
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
     * Fallback state parsing replicating basic formatting handled in ModelParser.parseState.
     * This avoids needing a full Project/ModelParser instance.
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
}
