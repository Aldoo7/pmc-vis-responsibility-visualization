package prism.api;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.TreeMap;

public class Info {

    private String id;
    private TreeMap<String, Object> stateInformation;
    private TreeMap<String, Object> transitionInformation;
    private TreeMap<String, Object> schedulerInformation;

    public Info(String id){
        this.id = id;
        this.stateInformation = new TreeMap<>();
        this.transitionInformation = new TreeMap<>();
        this.schedulerInformation = new TreeMap<>();
    }

    @JsonProperty
    public String getId() {
        return id;
    }

    @JsonProperty
    public TreeMap<String, Object> getS() {
        return stateInformation;
    }

    @JsonProperty
    public TreeMap<String, Object> getT() {
        return transitionInformation;
    }

    @JsonProperty
    public TreeMap<String, Object> getScheduler() {
        return schedulerInformation;
    }

    public void setStateEntry(String key, Object value) {
        this.stateInformation.put(key, value);
    }

    public void setTransitionEntry(String key, Object value) {
        this.transitionInformation.put(key, value);
    }

    public void setSchedulerEntry(String key, Object value) {
        this.schedulerInformation.put(key, value);
    }

    public Object getStateEntry(String key) {
        return this.stateInformation.get(key);
    }

    public Object getTransitionEntry(String key) {
        return this.transitionInformation.get(key);
    }

    public Object getSchedulerEntry(String key) {
        return this.schedulerInformation.get(key);
    }

    public Info copy() {
        Info newInfo = new Info(id);
        newInfo.stateInformation = new TreeMap<>(stateInformation);
        newInfo.transitionInformation = new TreeMap<>(transitionInformation);
        newInfo.schedulerInformation = new TreeMap<>(schedulerInformation);
        return newInfo;
    }
}
