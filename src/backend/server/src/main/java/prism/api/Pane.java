package prism.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.Arrays;
import java.util.List;

public class Pane {
    private String paneID;
    private String content;

    public Pane(){
        // Jackson deserialization
    }

    public Pane(String paneID, String content) {
        this.paneID = paneID;
        this.content = content;
    }

    @Schema(description = "Identifier of the pane")
    @JsonProperty
    public String getPaneID() {
        return paneID;
    }

    @Schema(description = "Content of the pane")
    @JsonProperty
    public String getContent() {
        return content;
    }
}
