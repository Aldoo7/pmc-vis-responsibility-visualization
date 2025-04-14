package prism.api;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import prism.core.Namespace;

import java.util.Map;

@Schema(description="Object representing a single Node of a Graph. Contains simply an identifier, and a type")
public interface Node extends Namespace {
    @Schema(description = "identifier of node")
    @JsonProperty
    String getId();

    @Schema(description = "Type of node")
    @JsonProperty
    String getType();

    @Schema(description = "Label of node (if applicable)")
    @JsonProperty
    String getName();

    @Schema(description = "View Details of node")
    @JsonProperty
    Map<String, Object> getViewDetails();

    @Schema(description = "")
    @JsonProperty
    Map<String, Map<String, Object>> getDetails();

    @JsonIgnore
    String getNumId();

    @JsonIgnore
    double getReward(String name);
}
