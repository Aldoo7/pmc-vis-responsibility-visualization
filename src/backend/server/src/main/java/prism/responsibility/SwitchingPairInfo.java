package prism.responsibility;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class SwitchingPairInfo {

    @JsonProperty("label")
    private String label;

    @JsonProperty("coalition")
    private List<String> coalition;

    @JsonProperty("winningRegion")
    private List<String> winningRegion;

    @JsonProperty("strategy")
    private Map<String, String> strategy;

    @JsonProperty("safeWins")
    private boolean safeWins;

    @JsonProperty("counterexample")
    private List<String> counterexample;

    @JsonProperty("memberImpact")
    private Map<String, Integer> memberImpact; // stateId → winning states lost when removed

    public SwitchingPairInfo() {}

    public SwitchingPairInfo(String label, List<String> coalition,
                             List<String> winningRegion,
                             Map<String, String> strategy,
                             boolean safeWins,
                             List<String> counterexample) {
        this.label = label;
        this.coalition = coalition;
        this.winningRegion = winningRegion;
        this.strategy = strategy;
        this.safeWins = safeWins;
        this.counterexample = counterexample;
    }

    public String getLabel() { return label; }
    public void setLabel(String label) { this.label = label; }

    public List<String> getCoalition() { return coalition; }
    public void setCoalition(List<String> coalition) { this.coalition = coalition; }

    public List<String> getWinningRegion() { return winningRegion; }
    public void setWinningRegion(List<String> winningRegion) { this.winningRegion = winningRegion; }

    public Map<String, String> getStrategy() { return strategy; }
    public void setStrategy(Map<String, String> strategy) { this.strategy = strategy; }

    public boolean isSafeWins() { return safeWins; }
    public void setSafeWins(boolean safeWins) { this.safeWins = safeWins; }

    public List<String> getCounterexample() { return counterexample; }
    public void setCounterexample(List<String> counterexample) { this.counterexample = counterexample; }

    public Map<String, Integer> getMemberImpact() { return memberImpact; }
    public void setMemberImpact(Map<String, Integer> memberImpact) { this.memberImpact = memberImpact; }
}
