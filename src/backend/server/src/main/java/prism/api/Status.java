package prism.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import prism.core.Project;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Schema(description="Object wrapping the neccessary information for a status call")
public class Status {

    private Info info;

    private List<String> messages;

    private int status;

    public Status(){
        this.info = null;
        this.messages = new ArrayList<>();
        this.messages.add("No Project with that name");
        this.status = 404;
    }

    public Status(Project project, List<String> messages){
        this.info = project.getInformation();
        this.messages = messages;
        this.status = 200;
    }

    @Schema(description = "Information about the MC process")
    @JsonProperty
    public Info getInfo() {
        return info;
    }

    @Schema(description = "Currently running tasks")
    @JsonProperty
    public List<String> getMessages() {
        return messages;
    }
}
