package prism.core.mdpgraph;

import prism.api.State;

import java.util.Map;


public class MdpState {

    private Long id;

    private Map<String, Object> variables;

    private boolean isFinal = false; // TODO remove, only for Performance testing of ReachabilityView

    MdpState(State state) {
        this.id = 0L; //state.getNumId();
        this.variables = state.getParameters();
    }

    public Map<String, Object> getVariable() {
        return variables;
    }

    public long getNumId() {
        return id;
    }

    public void setFinal() { isFinal = true; }

    public boolean isFinal() { return isFinal; } // TODO remove, only for Performance testing of ReachabilityView
}
