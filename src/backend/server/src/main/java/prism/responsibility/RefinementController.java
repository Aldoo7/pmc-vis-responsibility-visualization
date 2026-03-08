package prism.responsibility;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.*;
import java.util.function.BiConsumer;

/**
 * Manages incremental refinement for responsibility computation.
 * Supports start, pause, resume, and cancel operations.
 */
public class RefinementController {
    
    private static final Logger logger = LoggerFactory.getLogger(RefinementController.class);
    
    private final ResponsibilityEngine engine;
    private final ExecutorService executor;
    
    // Refinement state
    private volatile RefinementState state;
    private volatile int currentLevel;
    private volatile int targetLevel;
    private Future<?> computationTask;
    
    // Callbacks
    private BiConsumer<Integer, ResponsibilityOutput> progressCallback;
    private BiConsumer<String, Exception> errorCallback;
    private BiConsumer<Integer, RefinementState> completionCallback; // Called when COMPLETED
    
    public enum RefinementState {
        IDLE,      // Not running
        RUNNING,   // Currently computing
        PAUSED,    // Paused (can resume)
        CANCELLED, // Cancelled (cannot resume)
        COMPLETED  // Finished all levels
    }
    
    public RefinementController(ResponsibilityEngine engine) {
        this.engine = engine;
        this.executor = Executors.newSingleThreadExecutor();
        this.state = RefinementState.IDLE;
        this.currentLevel = 0;
        this.targetLevel = 0;
    }
    
    public void setProgressCallback(BiConsumer<Integer, ResponsibilityOutput> callback) {
        this.progressCallback = callback;
    }
    
    public void setErrorCallback(BiConsumer<String, Exception> callback) {
        this.errorCallback = callback;
    }

    public void setCompletionCallback(BiConsumer<Integer, RefinementState> callback) {
        this.completionCallback = callback;
    }
    
    public synchronized void start(String modelFile, String property, int targetLevel) {
        if (state == RefinementState.RUNNING) {
            logger.warn("Refinement already running, ignoring start request");
            return;
        }
        if (state == RefinementState.PAUSED) {
            logger.warn("Refinement is paused; resume instead of start");
            return;
        }
        if (state == RefinementState.COMPLETED) {
            logger.info("Previous refinement completed; starting new run");
        }
        
        logger.info("Starting refinement: model={}, property={}, targetLevel={}", 
            modelFile, property, targetLevel);
        
        this.currentLevel = 0;
        this.targetLevel = targetLevel;
        this.state = RefinementState.RUNNING;
        
        computationTask = executor.submit(() -> {
            try {
                runRefinement(modelFile, property);
            } catch (Exception e) {
                logger.error("Refinement failed", e);
                if (errorCallback != null) {
                    errorCallback.accept("Refinement failed: " + e.getMessage(), e);
                }
                state = RefinementState.IDLE;
            }
        });
    }
    
    public synchronized void pause() {
        if (state == RefinementState.RUNNING) {
            logger.info("Pausing refinement at level {}", currentLevel);
            state = RefinementState.PAUSED;
        } else {
            logger.warn("Cannot pause - state is {}", state);
        }
    }
    
    public synchronized void resume() {
        if (state == RefinementState.PAUSED) {
            logger.info("Resuming refinement from level {}", currentLevel);
            state = RefinementState.RUNNING;
            
            // Wake up waiting thread
            synchronized (this) {
                this.notifyAll();
            }
        } else {
            logger.warn("Cannot resume - state is {}", state);
        }
    }
    
    public synchronized void cancel() {
        logger.info("Cancelling refinement at level {}", currentLevel);
        state = RefinementState.CANCELLED;
        
        if (computationTask != null) {
            computationTask.cancel(true);
        }
        
        engine.terminate();
        
        // Wake up waiting thread so it can exit
        synchronized (this) {
            this.notifyAll();
        }
    }
    
    public synchronized RefinementState getState() {
        return state;
    }
    
    public synchronized int getCurrentLevel() {
        return currentLevel;
    }
    
    /**
     * The main refinement loop (runs in background thread)
     */
    private void runRefinement(String modelFile, String property) throws Exception {
        while (currentLevel <= targetLevel) {
            // Check state
            synchronized (this) {
                while (state == RefinementState.PAUSED) {
                    logger.debug("Waiting while paused...");
                    try {
                        this.wait();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        logger.info("Refinement interrupted while paused");
                        state = RefinementState.CANCELLED;
                        return;
                    }
                }
                
                if (state == RefinementState.CANCELLED) {
                    logger.info("Refinement cancelled at level {}", currentLevel);
                    return;
                }
            }
            
            logger.info("Computing level {}/{}", currentLevel, targetLevel);
            
            try {
                ResponsibilityOutput result = engine.compute(modelFile, property, currentLevel);
                
                if (progressCallback != null) {
                    progressCallback.accept(currentLevel, result);
                }
                
                currentLevel++;
                
            } catch (Exception e) {
                logger.error("Failed to compute level {}", currentLevel, e);
                if (errorCallback != null) {
                    errorCallback.accept("Failed at level " + currentLevel, e);
                }
                state = RefinementState.IDLE;
                throw e;
            }
        }
        
        synchronized (this) {
            state = RefinementState.COMPLETED;
        }
        logger.info("Refinement completed - reached level {}", targetLevel);
        if (completionCallback != null) {
            try {
                completionCallback.accept(targetLevel, RefinementState.COMPLETED);
            } catch (Exception e) {
                logger.warn("Completion callback threw exception: {}", e.getMessage());
            }
        }
    }
    
    public void shutdown() {
        logger.info("Shutting down refinement controller");
        cancel();
        executor.shutdown();
        try {
            if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
