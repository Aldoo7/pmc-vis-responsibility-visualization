package prism.responsibility;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Data Transfer Object for Responsibility Analysis Results
 * 
 * This class holds the output from the responsibility computation tool.
 * It includes:
 * - Refinement level (how detailed the analysis is)
 * - State responsibility values (stateId -> responsibility score 0.0-1.0)
 * - Component responsibility values (optional, for modules/variables/actions)
 * 
 * Example JSON output:
 * {
 *   "level": 3,
 *   "stateResponsibility": {
 *     "s_0": 0.123,
 *     "s_1": 0.856,
 *     "s_2": 0.432
 *   },
 *   "componentResponsibility": {
 *     "module_die1": 0.745,
 *     "variable_s1": 0.621
 *   }
 * }
 */
@JsonInclude(JsonInclude.Include.NON_NULL)  // Don't include null fields in JSON
public class ResponsibilityOutput {
    
    @JsonProperty("level")
    private int level;
    
    @JsonProperty("stateResponsibility")
    private Map<String, Double> stateResponsibility;
    
    @JsonProperty("componentResponsibility")
    private Map<String, Double> componentResponsibility;

    /* === Extended fields aligned with paper semantics === */
    @JsonProperty("responsibilityType") // optimistic | pessimistic
    private String responsibilityType;

    @JsonProperty("powerIndex") // shapley | banzhaf | custom
    private String powerIndex;

    @JsonProperty("weights") // weight vector p_0..p_{n-1}
    private List<Double> weights;

    @JsonProperty("normalizationConstantK") // optimistic constant K (if applicable)
    private Double normalizationConstantK;

    @JsonProperty("counterexample") // sequence s0..sk
    private List<String> counterexample;

    @JsonProperty("winningStates") // W_S_opt (states that can win alone)
    private List<String> winningStates;

    @JsonProperty("stateMetadata")
    private Map<String, StateInfo> stateMetadata; // enrichment per state

    @JsonProperty("approximate")
    private Boolean approximate;

    @JsonProperty("approximationStdDev")
    private Double approximationStdDev;

    @JsonProperty("groupedMode")
    private Boolean groupedMode;

    @JsonProperty("groups")
    private Map<String, GroupInfo> groups; // groupId -> info
    
    @JsonProperty("stateIdToName")
    private Map<String, String> stateIdToName; // Maps state ID -> human-readable name
    
    // Default constructor (required for Jackson deserialization)
    public ResponsibilityOutput() {
        this.stateResponsibility = new HashMap<>();
        this.componentResponsibility = new HashMap<>();
        this.stateMetadata = new HashMap<>();
        this.groups = new HashMap<>();
    }
    
    // Constructor with initial data
    public ResponsibilityOutput(int level, Map<String, Double> stateResponsibility) {
        this();
        this.level = level;
        this.stateResponsibility = stateResponsibility != null ? stateResponsibility : new HashMap<>();
    }
    
    // Getters and Setters
    public int getLevel() {
        return level;
    }
    
    public void setLevel(int level) {
        this.level = level;
    }
    
    public Map<String, Double> getStateResponsibility() {
        return stateResponsibility;
    }
    
    public void setStateResponsibility(Map<String, Double> stateResponsibility) {
        this.stateResponsibility = stateResponsibility;
    }
    
    public Map<String, Double> getComponentResponsibility() {
        return componentResponsibility;
    }
    
    public void setComponentResponsibility(Map<String, Double> componentResponsibility) {
        this.componentResponsibility = componentResponsibility;
    }

    public String getResponsibilityType() { return responsibilityType; }
    public void setResponsibilityType(String responsibilityType) { this.responsibilityType = responsibilityType; }

    public String getPowerIndex() { return powerIndex; }
    public void setPowerIndex(String powerIndex) { this.powerIndex = powerIndex; }

    public List<Double> getWeights() { return weights; }
    public void setWeights(List<Double> weights) { this.weights = weights; }

    public Double getNormalizationConstantK() { return normalizationConstantK; }
    public void setNormalizationConstantK(Double normalizationConstantK) { this.normalizationConstantK = normalizationConstantK; }

    public List<String> getCounterexample() { return counterexample; }
    public void setCounterexample(List<String> counterexample) { this.counterexample = counterexample; }

    public List<String> getWinningStates() { return winningStates; }
    public void setWinningStates(List<String> winningStates) { this.winningStates = winningStates; }

    public Map<String, StateInfo> getStateMetadata() { return stateMetadata; }
    public void setStateMetadata(Map<String, StateInfo> stateMetadata) { this.stateMetadata = stateMetadata; }

    public Boolean getApproximate() { return approximate; }
    public void setApproximate(Boolean approximate) { this.approximate = approximate; }

    public Double getApproximationStdDev() { return approximationStdDev; }
    public void setApproximationStdDev(Double approximationStdDev) { this.approximationStdDev = approximationStdDev; }

    public Boolean getGroupedMode() { return groupedMode; }
    public void setGroupedMode(Boolean groupedMode) { this.groupedMode = groupedMode; }

    public Map<String, GroupInfo> getGroups() { return groups; }
    public void setGroups(Map<String, GroupInfo> groups) { this.groups = groups; }

    public Map<String, String> getStateIdToName() { return stateIdToName; }
    public void setStateIdToName(Map<String, String> stateIdToName) { this.stateIdToName = stateIdToName; }
    
    @Override
    public String toString() {
        return String.format(
            "ResponsibilityOutput{level=%d, type=%s, index=%s, states=%d, components=%d, winning=%d, approx=%s}",
            level,
            responsibilityType,
            powerIndex,
            stateResponsibility != null ? stateResponsibility.size() : 0,
            componentResponsibility != null ? componentResponsibility.size() : 0,
            winningStates != null ? winningStates.size() : 0,
            Boolean.TRUE.equals(approximate));
    }

    /* === Helper inner classes === */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class StateInfo {
        @JsonProperty("onTrace")
        public Boolean onTrace;

        @JsonProperty("branchingDegree")
        public Integer branchingDegree;

        @JsonProperty("canWinAlone")
        public Boolean canWinAlone;

        public StateInfo() {}
        public StateInfo(Boolean onTrace, Integer branchingDegree, Boolean canWinAlone) {
            this.onTrace = onTrace;
            this.branchingDegree = branchingDegree;
            this.canWinAlone = canWinAlone;
        }
        
        public void setOnTrace(Boolean onTrace) {
            this.onTrace = onTrace;
        }
        
        public void setBranchingDegree(Integer branchingDegree) {
            this.branchingDegree = branchingDegree;
        }
        
        public void setCanWinAlone(Boolean canWinAlone) {
            this.canWinAlone = canWinAlone;
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class GroupInfo {
        @JsonProperty("members")
        public List<String> members;

        @JsonProperty("responsibility")
        public Double responsibility;

        public GroupInfo() {}
        public GroupInfo(List<String> members, Double responsibility) {
            this.members = members;
            this.responsibility = responsibility;
        }
    }
}
