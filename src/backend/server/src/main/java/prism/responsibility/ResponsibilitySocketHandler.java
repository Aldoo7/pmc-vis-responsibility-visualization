package prism.responsibility;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import prism.server.SocketServer;

import java.util.HashMap;
import java.util.Map;
import java.util.List;

/**
 * Socket.IO Event Handler for Responsibility Features
 * 
 * Listens for events from the frontend and coordinates responsibility computation.
 * 
 * Events IN (from frontend):
 *   - responsibility:start    -> Start refinement process
 *   - responsibility:pause    -> Pause refinement
 *   - responsibility:resume   -> Resume refinement
 *   - responsibility:cancel   -> Cancel refinement
 * 
 * Events OUT (to frontend):
 *   - responsibility:result   -> Progressive refinement results
 *   - responsibility:error    -> Error messages
 *   - responsibility:status   -> Status updates (running/paused/completed)
 * 
 * Example frontend usage:
 *   socket.emit('responsibility:start', {
 *     modelFile: '/path/to/model.prism',
 *     property: 'Pmax=?[F error]',
 *     targetLevel: 10
 *   });
 *   
 *   socket.on('responsibility:result', (data) => {
 *     console.log('Level', data.level, 'complete!');
 *     updateVisualization(data);
 *   });
 */
public class ResponsibilitySocketHandler {
    
    private static final Logger logger = LoggerFactory.getLogger(ResponsibilitySocketHandler.class);
    
    /**
     * DTO for the responsibility:start event payload
     */
    public static class StartRequestData {
        @JsonProperty("modelFile")
        private String modelFile;
        
        @JsonProperty("property")
        private String property;
        
        @JsonProperty("targetLevel")
        private int targetLevel;
        
        @JsonProperty("mode")
        private String mode; // optimistic | pessimistic
        
        @JsonProperty("powerIndex")
        private String powerIndex; // shapley | banzhaf | custom
        
        @JsonProperty("counterexample")
        private List<String> counterexample; // optional explicit rho

        @JsonProperty("projectId")
        private String projectId; // active project identifier
        
        // Getters and setters
        public String getModelFile() { return modelFile; }
        public void setModelFile(String modelFile) { this.modelFile = modelFile; }
        
        public String getProperty() { return property; }
        public void setProperty(String property) { this.property = property; }
        
        public int getTargetLevel() { return targetLevel; }
        public void setTargetLevel(int targetLevel) { this.targetLevel = targetLevel; }
        
        public String getMode() { return mode; }
        public void setMode(String mode) { this.mode = mode; }
        
        public String getPowerIndex() { return powerIndex; }
        public void setPowerIndex(String powerIndex) { this.powerIndex = powerIndex; }
        
        public List<String> getCounterexample() { return counterexample; }
        public void setCounterexample(List<String> counterexample) { this.counterexample = counterexample; }

        public String getProjectId() { return projectId; }
        public void setProjectId(String projectId) { this.projectId = projectId; }
    }

    /**
     * DTO for the model:upload event payload
     */
    public static class ModelUploadData {
        @JsonProperty("projectId")
        private String projectId;

        @JsonProperty("modelContent")
        private String modelContent;

        @JsonProperty("propsContent")
        private String propsContent;

        public String getProjectId() { return projectId; }
        public void setProjectId(String projectId) { this.projectId = projectId; }

        public String getModelContent() { return modelContent; }
        public void setModelContent(String modelContent) { this.modelContent = modelContent; }

        public String getPropsContent() { return propsContent; }
        public void setPropsContent(String propsContent) { this.propsContent = propsContent; }
    }
    
    // Socket.IO event names (constants to avoid typos)
    private static final String EVENT_START = "responsibility:start";
    private static final String EVENT_PAUSE = "responsibility:pause";
    private static final String EVENT_RESUME = "responsibility:resume";
    private static final String EVENT_CANCEL = "responsibility:cancel";
    private static final String EVENT_RESULT = "responsibility:result";
    private static final String EVENT_ERROR = "responsibility:error";
    private static final String EVENT_STATUS = "responsibility:status";
    private static final String EVENT_MODEL_UPLOAD = "model:upload";
    
    private final SocketServer socketServer;
    private final ResponsibilityEngine engine;
    private final RefinementController controller;
    private final String basePath; // for resolving model file paths
    
    /**
     * Constructor - wire up all event listeners
     */
    public ResponsibilitySocketHandler(SocketServer socketServer, String toolPath) {
        this(socketServer, toolPath, "volume");
    }

    /**
     * Full constructor with basePath for model resolution
     */
    public ResponsibilitySocketHandler(SocketServer socketServer, String toolPath, String basePath) {
        this.socketServer = socketServer;
        this.engine = new ResponsibilityEngine(toolPath);
        this.controller = new RefinementController(engine);
        this.basePath = basePath;
        
        // Set callbacks for controller
        controller.setProgressCallback(this::handleProgress);
        controller.setErrorCallback(this::handleError);
        controller.setCompletionCallback(this::handleCompleted);
        
        // Register event listeners
        registerEventListeners();
        
        logger.info("Responsibility Socket Handler initialized");
    }
    
    /**
     * Register all Socket.IO event listeners
     */
    private void registerEventListeners() {
        
        // Event: responsibility:start
        // Payload: { modelFile: string, property: string, targetLevel: number }
        socketServer.addEventListener(EVENT_START, StartRequestData.class,
            (client, data, ackRequest) -> {
                try {
                    StartRequestData request = (StartRequestData) data;
                    String modelFile = request.getModelFile();
                    String property = request.getProperty();
                    int targetLevel = request.getTargetLevel();
                    String mode = request.getMode();
                    String powerIndex = request.getPowerIndex();
                    List<String> rho = request.getCounterexample();
                    String projectId = request.getProjectId();
                    if (projectId == null || projectId.trim().isEmpty()) projectId = "0";
                    
                    // Resolve "current" to the actual loaded model file path
                    if ("current".equalsIgnoreCase(modelFile)) {
                        modelFile = basePath + "/" + projectId + "/model.prism";
                        logger.info("Resolved 'current' model file for project {} to {}", projectId, modelFile);
                    }
                    
                    logger.info("Received START command: project={}, model={}, property={}, targetLevel={}", 
                        projectId, modelFile, property, targetLevel);
                    
                    // Basic validation for mode/powerIndex
                    if (mode != null) mode = mode.trim().toLowerCase();
                    if (powerIndex != null) powerIndex = powerIndex.trim().toLowerCase();
                    java.util.Set<String> allowedModes = new java.util.HashSet<>(java.util.Arrays.asList("optimistic", "pessimistic"));
                    java.util.Set<String> allowedIndices = new java.util.HashSet<>(java.util.Arrays.asList("shapley", "banzhaf"));
                    if (mode != null && !allowedModes.contains(mode)) {
                        sendStatus("invalid-config", "Unknown mode '" + mode + "' (allowed: optimistic, pessimistic)");
                        return;
                    }
                    if (powerIndex != null && !allowedIndices.contains(powerIndex)) {
                        sendStatus("invalid-config", "Unknown powerIndex '" + powerIndex + "' (allowed: shapley, banzhaf)");
                        return;
                    }

                    // Apply configuration to engine (mock or real)
                    if (mode != null) {
                        engine.setMode(mode);
                    }
                    if (powerIndex != null) {
                        engine.setPowerIndex(powerIndex);
                    }
                    if (rho != null && !rho.isEmpty()) {
                        engine.setOverrideCounterexample(rho);
                    }
                    if (controller.getState() == RefinementController.RefinementState.RUNNING) {
                        sendStatus("already-running", "Refinement already in progress at level " + controller.getCurrentLevel());
                    } else if (controller.getState() == RefinementController.RefinementState.PAUSED) {
                        sendStatus("paused", "Refinement is paused at level " + controller.getCurrentLevel() + "; use resume");
                    } else {
                        controller.start(modelFile, property, targetLevel);
                        String ceInfo = (rho != null && !rho.isEmpty()) ? ", counterexample=present" : ", counterexample=none";
                        String mInfo = (mode != null ? mode : "(default)");
                        String pInfo = (powerIndex != null ? powerIndex : "(default)");
                        sendStatus("running", "Refinement started (mode=" + mInfo + ", index=" + pInfo + ceInfo + ")");
                    }
                    
                } catch (Exception e) {
                    logger.error("Failed to parse start event", e);
                    sendError("Invalid start command: " + e.getMessage(), null);
                }
            });
        
        // Event: responsibility:pause
        socketServer.addEventListener(EVENT_PAUSE, Object.class,
            (client, data, ackRequest) -> {
                logger.info("Received PAUSE command");
                if (controller.getState() == RefinementController.RefinementState.RUNNING) {
                    controller.pause();
                    sendStatus("paused", "Refinement paused at level " + controller.getCurrentLevel());
                } else {
                    sendStatus("invalid", "Cannot pause when state is " + controller.getState());
                }
            });
        
        // Event: responsibility:resume
        socketServer.addEventListener(EVENT_RESUME, Object.class,
            (client, data, ackRequest) -> {
                logger.info("Received RESUME command");
                if (controller.getState() == RefinementController.RefinementState.PAUSED) {
                    controller.resume();
                    sendStatus("running", "Refinement resumed");
                } else {
                    sendStatus("invalid", "Cannot resume when state is " + controller.getState());
                }
            });
        
        // Event: responsibility:cancel
        socketServer.addEventListener(EVENT_CANCEL, Object.class,
            (client, data, ackRequest) -> {
                logger.info("Received CANCEL command");
                if (controller.getState() == RefinementController.RefinementState.RUNNING
                    || controller.getState() == RefinementController.RefinementState.PAUSED) {
                    controller.cancel();
                    sendStatus("cancelled", "Refinement cancelled");
                } else {
                    sendStatus("invalid", "Nothing to cancel; state is " + controller.getState());
                }
            });

        // Event: model:upload
        // Payload: { projectId: string, modelContent: string, propsContent?: string }
        socketServer.addEventListener(EVENT_MODEL_UPLOAD, ModelUploadData.class,
            (client, data, ackRequest) -> {
                try {
                    ModelUploadData req = (ModelUploadData) data;
                    String projectId = (req.getProjectId() == null || req.getProjectId().trim().isEmpty()) ? "0" : req.getProjectId().trim();
                    String modelContent = req.getModelContent();
                    String propsContent = req.getPropsContent();
                    if (modelContent == null || modelContent.trim().isEmpty()) {
                        sendStatus("invalid-config", "Empty model content");
                        return;
                    }
                    java.nio.file.Path dir = java.nio.file.Paths.get(basePath, projectId);
                    java.nio.file.Files.createDirectories(dir);
                    java.nio.file.Path modelPath = dir.resolve("model.prism");
                    java.nio.file.Files.writeString(modelPath, modelContent);
                    if (propsContent != null && !propsContent.trim().isEmpty()) {
                        java.nio.file.Path propsPath = dir.resolve("property.props");
                        java.nio.file.Files.writeString(propsPath, propsContent);
                    }
                    logger.info("Uploaded model for project {} -> {} (props: {})", projectId, modelPath, propsContent != null);
                    sendStatus("model-uploaded", "Model updated for project " + projectId);
                } catch (Exception ex) {
                    logger.error("Model upload failed", ex);
                    sendError("Model upload failed: " + ex.getMessage(), ex);
                }
            });
    }
    
    /**
     * Called by RefinementController when a level completes
     */
    private void handleProgress(Integer level, ResponsibilityOutput result) {
        logger.info("Level {} complete, sending to frontend", level);
        
        // Send result to ALL connected clients
        socketServer.send(EVENT_RESULT, result);
        
        // Send status update
        sendStatus("running", "Completed level " + level);
    }

    /**
     * Called once when refinement reaches COMPLETED state.
     */
    private void handleCompleted(Integer finalLevel, RefinementController.RefinementState state) {
        if (state == RefinementController.RefinementState.COMPLETED) {
            logger.info("Refinement COMPLETED at level {}", finalLevel);
            sendStatus("completed", "Refinement completed at level " + finalLevel);
        }
    }
    
    /**
     * Called by RefinementController on error
     */
    private void handleError(String message, Exception exception) {
        logger.error("Refinement error: {}", message, exception);
        sendError(message, exception);
    }
    
    /**
     * Send error message to frontend
     */
    private void sendError(String message, Exception exception) {
        Map<String, Object> errorData = new HashMap<>();
        errorData.put("message", message);
        if (exception != null) {
            errorData.put("details", exception.getMessage());
        }
        errorData.put("timestamp", System.currentTimeMillis());
        
        socketServer.send(EVENT_ERROR, errorData);
    }
    
    /**
     * Send status update to frontend
     */
    private void sendStatus(String state, String message) {
        Map<String, Object> statusData = new HashMap<>();
        statusData.put("state", state);
        statusData.put("message", message);
        statusData.put("currentLevel", controller.getCurrentLevel());
        statusData.put("timestamp", System.currentTimeMillis());
        statusData.put("internalState", controller.getState().name());
        
        socketServer.send(EVENT_STATUS, statusData);
    }
    
    /**
     * Shutdown handler (call on server shutdown)
     */
    public void shutdown() {
        logger.info("Shutting down responsibility socket handler");
        controller.shutdown();
    }
}
