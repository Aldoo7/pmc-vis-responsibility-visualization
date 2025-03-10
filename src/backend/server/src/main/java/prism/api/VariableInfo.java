package prism.api;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import parser.type.Type;
import parser.type.TypeVoid;
import prism.core.Namespace;

import java.util.Map;
import java.util.TreeMap;

@Schema(description="Information Object for Variables and Properties")
public class VariableInfo implements Namespace {

    private final String variableName;

    private final String type;

    private final double minValue;

    private final double maxValue;

    private final boolean ready;

    public static VariableInfo blank(String name){
        return new VariableInfo(name, TypeVoid.getInstance(), 0, 0, false);
    }

    public VariableInfo(String name, Type type, double minValue, double maxValue){
        this(name, type, minValue, maxValue, true);
    }

    public VariableInfo(String name, Type type, double minValue, double maxValue, boolean ready){
        this.variableName = name;
        switch(type.getTypeString()){
            case "int":
            case "double":
                this.type = TYPE_NUMBER;
                break;
            case "bool":
                this.type = TYPE_BOOLEAN;
                break;
            case "void":
                this.type = TYPE_BLANK;
                break;
            default:
                this.type = "nominal";
        }
        this.minValue = minValue;
        this.maxValue = maxValue;
        this.ready = ready;
    }

    @JsonIgnore
    public String getVariableName(){
        return variableName;
    }

    @JsonProperty
    public String getType() {
        return type;
    }

    @JsonProperty
    public double getMinValue() {
        return minValue;
    }

    @JsonProperty
    public double getMaxValue() {
        return maxValue;
    }

    @JsonProperty
    public boolean isReady() {
        return ready;
    }
}
