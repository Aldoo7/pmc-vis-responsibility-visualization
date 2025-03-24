package prism.api;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import prism.core.Namespace;

@Schema(description="Information Object for Variables and Properties")
public class VariableInfo implements Namespace {

    public enum Type {TYPE_BLANK, TYPE_NUMBER, TYPE_BOOL};

    public enum Status {missing, ready, computing}

    private final String variableName;

    private final String type;

    private final double minValue;

    private final double maxValue;

    private Status status;

    public static VariableInfo blank(String name){
        return new VariableInfo(name, Type.TYPE_BLANK, 0, 0, Status.missing);
    }

    public static Type parseType(String typeName){
        switch (typeName){
            case "double":
            case "integer":
            case "int":
            case "number":
                return Type.TYPE_NUMBER;
            case "boolean":
                return Type.TYPE_BOOL;
            default:
                return Type.TYPE_BLANK;
        }
    }

    public VariableInfo(String name, Type type, double minValue, double maxValue){
        this(name, type, minValue, maxValue, Status.ready);
    }

    public VariableInfo(String name, Type type, double minValue, double maxValue, Status status){
        this.variableName = name;
        switch(type){
            case TYPE_NUMBER:
                this.type = TYPE_NUMBER;
                break;
            case TYPE_BOOL:
                this.type = TYPE_BOOLEAN;
                break;
            case TYPE_BLANK:
            default:
                this.type = TYPE_BLANK;
                break;
        }
        this.minValue = minValue;
        this.maxValue = maxValue;
        this.status = status;
    }

    @JsonIgnore
    public String getVariableName(){
        return variableName;
    }

    @JsonIgnore
    public void setStatus(Status status){
        this.status = status;
    }


    @JsonProperty
    public String getType() {
        return type;
    }

    @JsonProperty
    public double getMin() {
        return minValue;
    }

    @JsonProperty
    public double getMax() {
        return maxValue;
    }

    @JsonProperty
    public String status() {
        return status.toString();
    }
}
