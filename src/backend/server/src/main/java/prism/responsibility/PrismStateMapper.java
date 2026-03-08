package prism.responsibility;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Extracts state ID to name mapping using the PRISM CLI
 * (prism model.prism -exportstates states.txt).
 */
public class PrismStateMapper {
    
    private static final Logger logger = LoggerFactory.getLogger(PrismStateMapper.class);
    
    public static Map<String, String> extractStateMapping(String modelFile) {
        Map<String, String> mapping = new LinkedHashMap<>();
        
        try {
            // Get PRISM path from environment or use default
            String prismPath = System.getenv("RESP_PRISM_PATH");
            if (prismPath == null || prismPath.isEmpty()) {
                prismPath = "prism";
            }
            
            // Create temp file for state export
            Path tempDir = Files.createTempDirectory("prism_states_");
            Path statesFile = tempDir.resolve("states.txt");
            
            // Build command: prism model.prism -exportstates states.txt
            ProcessBuilder pb = new ProcessBuilder(
                prismPath,
                modelFile,
                "-exportstates",
                statesFile.toString()
            );
            
            logger.info("Running PRISM CLI to extract states: {} -exportstates", prismPath);
            long start = System.currentTimeMillis();
            
            Process proc = pb.start();
            
            StringBuilder output = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    output.append(line).append('\n');
                }
            }
            
            int exitCode = proc.waitFor();
            long ms = System.currentTimeMillis() - start;
            
            if (exitCode != 0) {
                logger.error("PRISM CLI failed (exit={}). Output:\n{}", exitCode, output);
                return mapping;
            }
            
            logger.debug("PRISM CLI completed in {} ms", ms);
            
            // Parse states file
            // Format: (var1,var2,var3)      <-- header with variable names
            //         0:(val1,val2,val3)
            //         1:(val1,val2,val3)
            Pattern headerPattern = Pattern.compile("^\\((.+)\\)$");
            Pattern statePattern = Pattern.compile("^(\\d+):\\((.+)\\)$");
            String[] varNames = null;
            
            if (Files.exists(statesFile)) {
                int count = 0;
                for (String line : Files.readAllLines(statesFile, StandardCharsets.UTF_8)) {
                    line = line.trim();
                    if (line.isEmpty()) continue;
                    
                    // Try header first
                    if (varNames == null) {
                        Matcher hm = headerPattern.matcher(line);
                        if (hm.matches()) {
                            varNames = hm.group(1).split(",");
                            for (int i = 0; i < varNames.length; i++) {
                                varNames[i] = varNames[i].trim();
                            }
                            logger.debug("State variables: {}", String.join(", ", varNames));
                            continue;
                        }
                    }
                    
                    Matcher m = statePattern.matcher(line);
                    if (m.matches()) {
                        String id = m.group(1);
                        String[] values = m.group(2).split(",");
                        
                        // Produce name in the same format as ModelParser.normalizeStateName():
                        // semicolons, values only (no var names), no parentheses.
                        // This ensures the frontend can match state IDs to graph nodes.
                        StringBuilder sb = new StringBuilder();
                        for (int i = 0; i < values.length; i++) {
                            if (sb.length() > 0) sb.append(";");
                            sb.append(values[i].trim());
                        }
                        String stateName = sb.toString();
                        mapping.put(id, stateName);
                        count++;
                        
                        if (count <= 3) {
                            logger.debug("Matched state: {} -> {}", id, stateName);
                        }
                    }
                }
                logger.info("Extracted state mapping: {} states ({} vars) in {} ms", 
                        mapping.size(), varNames != null ? varNames.length : 0, ms);
            } else {
                logger.warn("States file not created: {}", statesFile);
            }
            
            Files.deleteIfExists(statesFile);
            Files.deleteIfExists(tempDir);
            
        } catch (Exception e) {
            logger.error("Failed to extract state mapping: {}", e.getMessage(), e);
        }
        
        return mapping;
    }
}
