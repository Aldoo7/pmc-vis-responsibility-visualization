package prism.api;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.*;
import java.util.stream.Collectors;

public class Transition implements Node{

    private String id;
    private String source;

    private String action;

    private Map<String, Double> probabilityDistribution;

    private TreeMap<String, Double> results;

    private TreeMap<String, Double> rewards;

    private TreeMap<String, Double> scheduler;

    private List<String> views;

    public Transition(){
        // Jackson deserialization
    }

    public Transition(String id, String source, String action, Map<String, Double> probabilityDistribution, Map<String, Double> rewards, Map<String, Double> results, Map<String, Double> scheduler, List<String> views,  Map<String, String> translation){
        this.id = id;
        this.source = source;
        this.action = action;
        this.views = views;
        if (results != null) this.results = new TreeMap<>(results); else this.results = new TreeMap<>();
        if (rewards != null) this.rewards = new TreeMap<>(rewards); else this.rewards = new TreeMap<>();
        if (scheduler != null) this.scheduler = new TreeMap<>(scheduler); else this.scheduler = new TreeMap<>();
        if (translation == null) {
            this.probabilityDistribution = probabilityDistribution;
        }
        else{
            Map<String, Double> translated = new HashMap<>();
            Double d = 0.0;
            for (Map.Entry<String, Double> e : probabilityDistribution.entrySet()) {
                translated.put(translation.get(e.getKey()), e.getValue());
                d += e.getValue();
            }
            this.probabilityDistribution = new HashMap<>(translated);
            if (d>1.0){
                for (String state : translated.keySet()){
                    this.probabilityDistribution.replace(state, translated.get(state)/d);
                }
            }
        }
    }

    private boolean viewsInactive() { 
        return views == null || views.isEmpty();
    }

    @Override
    public String getId() {
        return viewsInactive() ? String.format("t%s", id) : String.format("t%s_%s", String.join("_", views), id);
    }

    @Override
    public String getType() {
        return "t";
    }


    @Override
    public String getName() {
        return null;
    }

    @Override
    public Map<String, Map<String, Object>> getDetails() {
        Map<String, Map<String, Object>> details = new HashMap<>();
        Map<String, Object> parameters = new TreeMap<>();
        parameters.put(ENTRY_T_OUT, source);
        parameters.put(ENTRY_T_ACT, action);
        parameters.put(ENTRY_T_PROB, probabilityDistribution);

        details.put(OUTPUT_ACTION, parameters);
        details.put(OUTPUT_REWARDS, new TreeMap<>(rewards));
        details.put(OUTPUT_RESULTS, new TreeMap<>(results));
        details.put(OUTPUT_SCHEDULER, new TreeMap<>(scheduler));
        return details;
    }

    @Override
    public Map<String, Object> getViewDetails() {
        Map<String, Object> output = new HashMap<>();
        output.put("views identifier", views);
        return output;
    }

    //@Override
    public String getNumId() {
        return id;
    }

    @Schema(description = "Does the scheduler for this property use this transition")
    @JsonProperty
    public Map<String, Double> getScheduler(){
        return scheduler;
    }

    @JsonIgnore
    public String getSource() {
        return source;
    }

    @JsonIgnore
    public Map<String, Double> getResults() {
        return results;
    }

    @JsonIgnore
    private String viewForm(String id){
        return viewsInactive() ? id : String.format("%s_%s", String.join("_", views), id);
    }

    @JsonIgnore
    public String getAction() {
        return action;
    }

    @JsonIgnore
    public Map<String, Double> getProbabilityDistribution() {
        return probabilityDistribution;
    }

    @Override
    public double getReward(String name) {
        if (!rewards.containsKey(name)){
            double value = 0.0;
            for (double reward : rewards.values()){
                value += reward;
            }
            return value;
        }
        return rewards.get(name);
    }

    @JsonIgnore
    public List<Edge> createEdges(){
        List<Edge> edges = new ArrayList<>();
        edges.add(new Edge(viewForm(source), this.getId(), action));
        for (Map.Entry<String, Double> e : probabilityDistribution.entrySet()) {
            edges.add(new Edge(this.getId(), viewForm(e.getKey()), Double.toString(e.getValue())));
        }
        return edges;
    }
}
