package prism.core.View;

import prism.api.State;
import prism.api.Transition;
import prism.core.Project;
import prism.core.mdpgraph.MdpGraph;
import prism.core.mdpgraph.MdpTransition;

import java.util.*;
import java.util.stream.Collectors;

public class OutActIdentView extends View {

    enum ViewModes {STRONG, WEAK}

    ViewModes viewMode = ViewModes.WEAK;

    public OutActIdentView(Project parent, long id, Collection<String> attributeSetter) throws Exception {
        super(parent, ViewType.OutActIdentView, id);
        attributes.putAll(setAttributes(attributeSetter));
    }

    public OutActIdentView(Project parent, long id, String viewMode) {
        super(parent, ViewType.OutActIdentView, id);
        this.viewMode = viewMode.equals("strong") ? ViewModes.STRONG : ViewModes.WEAK;
    }

    @Override
    protected Map<String, Object> assignAttributes(String attName, String attValue) throws Exception {
        Map<String, Object> modifiedAttributes = new HashMap<>();
        attName = attName.toLowerCase();
        switch (attName) {
            case "viewmode":
                viewMode = ViewModes.valueOf(attValue.toUpperCase());
                attributes.put(attName, viewMode);
                break;
            default:
                throw new RuntimeException(attName);
        }
        return modifiedAttributes;
    }

    @Override
    protected List<String> groupingFunction() {
        List<String> toExecute = new ArrayList<>();

        // Create views by checking AP Labels
        // WEAK identity requires that the set of actions must be identical - THE QUANTITY OF AN ACTION DOES NOT MATTER
        MdpGraph mdpGraph = model.getMdpGraph();

        switch (viewMode) {
            case WEAK:
                // use sorted set
                // quantity of the actions doesnt matter
                for (Long stateId : relevantStates) {
                    SortedSet<String> actions = mdpGraph.outgoingEdgesOf(stateId).stream()
                            .map(mdpGraph::getTransObj)
                            .map(MdpTransition::getAction)
                            .collect(Collectors.toCollection(TreeSet::new));
                    String actionString = semiGrouping && actions.isEmpty() ? ENTRY_C_BLANK : actions.toString();
                    toExecute.add(String.format("UPDATE %s SET %s = '%s' WHERE %s = '%s'", model.getStateTableName(), getCollumn(), actionString, ENTRY_S_ID, stateId));
                }
                break;
            case STRONG:
                // use sorted list
                // quantity of actions does matter
                for (Long stateId : relevantStates) {
                    List<String> actions = mdpGraph.outgoingEdgesOf(stateId).stream()
                            .map(mdpGraph::getTransObj)
                            .map(MdpTransition::getAction)
                            .sorted()
                            .collect(Collectors.toList());
                    String actionString = semiGrouping && actions.isEmpty() ? ENTRY_C_BLANK : actions.toString();
                    toExecute.add(String.format("UPDATE %s SET %s = '%s' WHERE %s = '%s'", model.getStateTableName(), getCollumn(), actionString, ENTRY_S_ID, stateId));
                }
                break;
        }

        return toExecute;
    }

    @Deprecated
    protected List<String> groupingFunctionOld() {
        List<String> toExecute = new ArrayList<>();

        Set<State> states = model.getStates(model.getAllStates())
                .stream()
                .filter(state -> relevantStates.contains(Long.parseLong(state.getNumId())))
                .collect(Collectors.toSet());

        // WEAK identity requires that the set of actions must be identical - THE QUANTITY OF AN ACTION DOES NOT MATTER
        switch (viewMode) {
            case WEAK:
                for (State state : states) {
                    SortedSet<String> actions = new TreeSet<>();
                    for (Transition trans : model.getOutgoingList(state.getNumId())) {
                        actions.add(trans.getAction());
                    }
                    String actionString = semiGrouping && actions.isEmpty() ? ENTRY_C_BLANK : actions.toString();
                    toExecute.add(String.format("UPDATE %s SET %s = '%s' WHERE %s = '%s'", model.getStateTableName(), getCollumn(), actionString, ENTRY_S_ID, state.getNumId()));
                }
                break;
            case STRONG:
                // STRONG identity requires that the collection of actions must be EXACTLY identical - THE QUANTITY OF AN ACTION DOES MATTER
                for (State state : states) {
                    List<String> actions = new ArrayList<>();
                    for (Transition trans : model.getOutgoingList(state.getNumId())) {
                        actions.add(trans.getAction());
                    }
                    Collections.sort(actions);
                    String actionString = semiGrouping && actions.isEmpty() ? ENTRY_C_BLANK : actions.toString();
                    toExecute.add(String.format("UPDATE %s SET %s = '%s' WHERE %s = '%s'", model.getStateTableName(), getCollumn(), actionString, ENTRY_S_ID, state.getNumId()));
                }
                break;
        }

        return toExecute;
    }

    @Override
    public String getCollumn() {
        return ViewType.OutActIdentView.name();
    }
}
