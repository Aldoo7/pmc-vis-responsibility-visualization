package prism.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import prism.core.Project;
import prism.core.Scheduler.Scheduler;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;

@Schema(description="Object representing an entire Graph")
public class Graph {
    private List<Node> nodes;

    private List<Edge> edges;

    private Info info;

    public Graph(){
        // Jackson deserialization
    }

    public Graph(Project project, List<State> states, List<Transition> transitions) {
        this.info = project.getInformation();
        this.nodes = new ArrayList<>(states);
        this.nodes.addAll(transitions);
        this.edges = new ArrayList<>();
        for (Transition t : transitions){
            edges.addAll(t.createEdges());
        }
    }

    @Schema(description = "all nodes in the graph")
    @JsonProperty
    public List<Node> getNodes() {
        return nodes;
    }

    @Schema(description = "all edges in the graph")
    @JsonProperty
    public List<Edge> getEdges() {
        return edges;
    }

    @Schema(description = "Information about the MC process")
    @JsonProperty
    public Info getInfo() {
        return info;
    }
}