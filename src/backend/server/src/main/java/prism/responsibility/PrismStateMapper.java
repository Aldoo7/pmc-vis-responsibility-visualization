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
 * Lightweight state ID to name mapper using PRISM CLI.
 * 
 * This avoids the slow PRISM Java API (which loads the entire model).
 * Instead, we run: prism model.prism -exportstates states.txt
 * 
 * Based on the solution from November 26, 2025 report:
 * "I switched to using PRISM's command-line tool instead...
 *  This just dumps the state IDs and their representations to a file.
 *  Super simple. Super fast."
 */
public class PrismStateMapper {
    
    private static final Logger logger = LoggerFactory.getLogger(PrismStateMapper.class);
    
    /**
     * Extract state ID to name mapping using PRISM CLI.
     * 
     * @param modelFile Path to .prism model file
     * @return Map of state ID (0, 1, 2...) to state name ((false,false,...))
     */
    public static Map<String, String> extractStateMapping(String modelFile) {
        Map<String, String> mapping = new LinkedHashMap<>();
        
        try {
            // Get PRISM path from environment or use default
            String prismPath = System.getenv("RESP_PRISM_PATH");
            if (prismPath == null || prismPath.isEmpty()) {
                prismPath = "prism"; // assume in PATH
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
            
            // Capture output (mostly for error diagnosis)
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
            // Format: 0:(false,false,false,true,true,...)
            //         1:(true,false,false,false,true,...)
            Pattern pattern = Pattern.compile("^(\\d+):\\((.+)\\)$");
            
            if (Files.exists(statesFile)) {
                int count = 0;
                for (String line : Files.readAllLines(statesFile, StandardCharsets.UTF_8)) {
                    line = line.trim();
                    if (line.isEmpty()) continue;
                    
                    Matcher m = pattern.matcher(line);
                    if (m.matches()) {
                        String id = m.group(1);
                        String stateName = "(" + m.group(2) + ")"; // Add parentheses back
                        mapping.put(id, stateName);
                        count++;
                        
                        // Log first few for debugging
                        if (count <= 3) {
                            logger.debug("Matched state: {} -> {}", id, stateName);
                        }
                    }
                }
                logger.info("Extracted state mapping: {} states in {} ms", mapping.size(), ms);
            } else {
                logger.warn("States file not created: {}", statesFile);
            }
            
            // Clean up temp files
            Files.deleteIfExists(statesFile);
            Files.deleteIfExists(tempDir);
            
        } catch (Exception e) {
            logger.error("Failed to extract state mapping: {}", e.getMessage(), e);
        }
        
        return mapping;
    }
}
