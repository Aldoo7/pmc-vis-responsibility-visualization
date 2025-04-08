package prism.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.Arrays;
import java.util.List;

public class Pane {
    private long paneID;
    private List<String> states;

    public Pane(){
        // Jackson deserialization
    }

    public Pane(long paneID, List<String> states) {
        this.paneID = paneID;
        this.states = states;
    }

    public Pane(long paneID, String stateString){
        this(paneID, Arrays.asList(stateString.split(",")));
    }

    @Schema(description = "Identifier of the projeProject")
    @JsonProperty
    public long getPaneID() {
        return paneID;
    }

    @Schema(description = "Identifier of the projeProject")
    @JsonProperty
    public List<String> getStates() {
        return states;
    }
}
