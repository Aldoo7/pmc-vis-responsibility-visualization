package prism.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import prism.core.Project;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Schema(description="Object wrapping the neccessary information for a status call")
public class Status {

    private TreeMap<String, Object> info;

    private List<String> messages;

    public Status(){
        // Jackson deserialization
    }

    public Status(Project project, List<String> messages){
        this.info = project.getInformation();
        this.messages = messages;
    }

    @Schema(description = "Information about the MC process")
    @JsonProperty
    public Map<String, Object> getInfo() {
        return info;
    }

    @Schema(description = "Currently running tasks")
    @JsonProperty
    public List<String> getMessages() {
        return messages;
    }
}
