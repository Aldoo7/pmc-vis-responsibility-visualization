package prism.responsibility;

import java.util.ArrayList;
import java.util.List;

/**
 * Represents a loop-free counterexample trace s0 ... sk ending in a bad state.
 */
public class Counterexample {
    private final List<String> states = new ArrayList<>();

    public void add(String state) { 
        states.add(state); 
    }

    public Counterexample() {}

    public Counterexample(List<String> initialStates) {
        if (initialStates != null) states.addAll(initialStates);
    }
    
    public List<String> getStates() { 
        return states; 
    }
    
    public List<String> getTrace() {
        return states;
    }
    
    public String last() { 
        return states.isEmpty() ? null : states.get(states.size() - 1); 
    }
}
