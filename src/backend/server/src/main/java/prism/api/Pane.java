package prism.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.swagger.v3.oas.annotations.media.Schema;
import jltl2dstar.Scheduler;

import java.util.*;

public class Pane {
    private Map<String, String> content;

    public Pane(){
        // Jackson deserialization
    }

    public Pane(String paneID, String content) {
        this.content = new TreeMap<>();
        this.content.put(paneID, content);
    }

    @Schema(description = "Content of the pane")
    @JsonProperty
    public Map<String, ObjectNode> getContent() {
        ObjectMapper mapper = new ObjectMapper();
        Map<String, ObjectNode> map = new HashMap<>();
        for (Map.Entry<String, String> entry : this.content.entrySet()) {
            try {
                ObjectNode value = mapper.readValue(entry.getValue(), ObjectNode.class);
                map.put(entry.getKey(), value);
            } catch (JsonProcessingException e) {
                throw new RuntimeException(e);
            }
        }
        return map;
    }

    public Map<String, String> getContentAsMap() {
        return content;
    }

    public void join(Pane pane) {
        this.content.putAll(pane.getContentAsMap());
    }
}
