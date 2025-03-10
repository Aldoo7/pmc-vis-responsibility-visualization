package prism.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import prism.core.Namespace;

public class AP {

    private String identifier;

    private boolean icon;

    public AP(){
        // Jackson deserialization
    }

    public AP(String identifier, boolean icon){
        this.identifier = identifier;
        this.icon = icon;
    }

    @Schema(description = "Identifier used (either URL if icon true, otherwise Name)")
    @JsonProperty
    public String getIdentifier() {
        return identifier;
    }

    @JsonProperty
    public String getType() {
        return Namespace.TYPE_BOOLEAN;
    }

    @Schema(description = "Does this AP have an icon?")
    @JsonProperty
    public boolean isIcon() {
        return icon;
    }


}
