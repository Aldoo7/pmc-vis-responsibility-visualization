package prism.responsibility;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class ResponsibilityOutput {
    
    @JsonProperty("level")
    private int level;
    
    @JsonProperty("stateResponsibility")
    private Map<String, Double> stateResponsibility;
    
    @JsonProperty("componentResponsibility")
    private Map<String, Double> componentResponsibility;

    @JsonProperty("responsibilityType")
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
    private Map<String, String> stateIdToName;
    
    @JsonProperty("samplingConfig")
    private String samplingConfig; // Sampling configuration used (e.g., "10000" or "60s")
    
    @JsonProperty("groupingMode")
    private String groupingMode;

    @JsonProperty("switchingPairs")
    private List<SwitchingPairInfo> switchingPairs; // Per-coalition safety game results

    @JsonProperty("switchingPairStats")
    private Map<String, SwitchingPairStats> switchingPairStats; // Per-player: real switching pair data from Shapley computation
    
    public ResponsibilityOutput() {
        this.stateResponsibility = new HashMap<>();
        this.componentResponsibility = new HashMap<>();
        this.stateMetadata = new HashMap<>();
        this.groups = new HashMap<>();
    }
    
    public ResponsibilityOutput(int level, Map<String, Double> stateResponsibility) {
        this();
        this.level = level;
        this.stateResponsibility = stateResponsibility != null ? stateResponsibility : new HashMap<>();
    }
    
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
    
    public String getSamplingConfig() { return samplingConfig; }
    public void setSamplingConfig(String samplingConfig) { this.samplingConfig = samplingConfig; }
    
    public String getGroupingMode() { return groupingMode; }
    public void setGroupingMode(String groupingMode) { this.groupingMode = groupingMode; }

    public List<SwitchingPairInfo> getSwitchingPairs() { return switchingPairs; }
    public void setSwitchingPairs(List<SwitchingPairInfo> switchingPairs) { this.switchingPairs = switchingPairs; }

    public Map<String, SwitchingPairStats> getSwitchingPairStats() { return switchingPairStats; }
    public void setSwitchingPairStats(Map<String, SwitchingPairStats> switchingPairStats) { this.switchingPairStats = switchingPairStats; }
    
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

    /**
     * Per-player switching pair statistics from the full Shapley computation.
     * A switching pair (C, x) exists when v(C)=0 and v(C∪{x})=1.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class SwitchingPairStats {
        @JsonProperty("pivotalCount")
        public int pivotalCount;           // Number of coalitions where this player is pivotal

        @JsonProperty("totalCoalitions")
        public int totalCoalitions;        // Total coalitions checked (2^(n-1))

        @JsonProperty("shapleyValue")
        public double shapleyValue;        // Computed Shapley value for cross-check

        @JsonProperty("examples")
        public List<List<String>> examples; // Representative switching pair coalitions (up to 10, raw state IDs)

        public SwitchingPairStats() {}
        public SwitchingPairStats(int pivotalCount, int totalCoalitions, double shapleyValue) {
            this.pivotalCount = pivotalCount;
            this.totalCoalitions = totalCoalitions;
            this.shapleyValue = shapleyValue;
        }
    }
}
