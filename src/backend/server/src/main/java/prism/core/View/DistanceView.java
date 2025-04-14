package prism.core.View;

import prism.core.Project;
import prism.core.mdpgraph.MdpGraph;

import java.util.*;
import java.util.stream.Collectors;

/**
 * View that views all state by distance to a set of states specified by an expression.
 */
public class DistanceView extends View {

    public enum DistanceDirection{FORWARD, BACKWARD, DIRECTIONLESS, REACHABLE}

    private String identifierExpression = "init";

    private long granularity = 1;


    private DistanceDirection direction = DistanceDirection.FORWARD;

    public DistanceView(Project parent, long id, Collection<String> attributeSetter) throws Exception {
        super(parent, ViewType.DistanceView, id);
        attributes.put("identexpression", identifierExpression);
        attributes.put("granularity", granularity);
        attributes.put("direction", direction);
        attributes.putAll(setAttributes(attributeSetter));
    }

    public DistanceView(Project parent, long id, String identifierExpression, long granularity, DistanceDirection direction) {
        super(parent, ViewType.DistanceView, id);
        this.direction = direction;
        this.identifierExpression = identifierExpression;
        this.granularity = granularity;
        attributes.put("identexpression", identifierExpression);
        attributes.put("granularity", granularity);
        attributes.put("direction", direction);
    }

    @Override
    protected Map<String, Object> assignAttributes(String attName, String attValue) throws Exception {
        Map<String, Object> modifiedAttributes = new HashMap<>();
        attName = attName.toLowerCase();
        switch (attName) {
            case "identifierexpression":
            case "identexpression":
            case "identexpr":
                identifierExpression = attValue;
                modifiedAttributes.put("identexpression", identifierExpression);
                break;
            case "granularity":
                granularity = Long.parseLong(attValue);
                modifiedAttributes.put(attName, granularity);
                break;
            case "direction":
                direction = DistanceDirection.valueOf(attValue.toUpperCase());
                modifiedAttributes.put(attName, direction);
                break;
            default:
                modifiedAttributes.put("Error", "Could not find attribute " + attName);
        }
        return modifiedAttributes;
    }

    @Override
    protected List<String> groupingFunction() throws Exception {
        List<String> toExecute = new ArrayList<>();

        // Compute reachability score
        Set<String> visited = new HashSet<>();
        Set<String> visiting = new HashSet<>();
        long distance = 0;

        // initialise states with expression
        if (identifierExpression.equals("init")){
            Set<String> subsetInitStates = model.getInitialStates()
                    .stream()
                    .filter(stateId -> relevantStates.contains(stateId))
                    .collect(Collectors.toSet());
            visiting.addAll(subsetInitStates);
        } else {
            Set<String> subsetStates = model.getStatesByExpression(model.getModelParser().parseSingleExpressionString(identifierExpression).toString())
                    .stream()
                    .filter(stateId -> relevantStates.contains(stateId))
                    .collect(Collectors.toSet());
            visiting.addAll(subsetStates);
            visiting.addAll(subsetStates);
        }
        MdpGraph mdpGraph = model.getMdpGraph();

        // Determine distance from Expression states (both ways)
        while(!visiting.isEmpty()){
            Set<String> toVisit = new HashSet<>();

            for (String stateID : visiting){
                long curr = distance - Math.floorMod(distance, granularity);
//                    if (!(direction == DistanceDirection.REACHABLE))
                toExecute.add(String.format("UPDATE %s SET %s = '%s' WHERE %s = '%s'", model.getStateTableName(), getCollumn(), curr, ENTRY_S_ID, stateID));

                Set<Long> reachableStates;

                // See all outgoing
                switch (direction) {
//                        case REACHABLE:
                    case BACKWARD:
                        reachableStates = mdpGraph.incomingEdgesOf(Long.parseLong(stateID))
                                .stream()
                                .map(mdpGraph::getEdgeSource)
                                .filter(stateId -> relevantStates.contains(stateId))
                                .collect(Collectors.toSet());
                        break;
                    case DIRECTIONLESS:
                        reachableStates =
                                mdpGraph.outgoingEdgesOf(Long.parseLong(stateID))
                                .stream()
                                .map(mdpGraph::getEdgeTarget)
                                .filter(stateId -> relevantStates.contains(stateId))
                                .collect(Collectors.toSet());
                        reachableStates.addAll(
                                mdpGraph.incomingEdgesOf(Long.parseLong(stateID))
                                .stream()
                                .map(mdpGraph::getEdgeSource)
                                .filter(stateId -> relevantStates.contains(stateId))
                                .collect(Collectors.toSet())
                        );
                        break;
                    case FORWARD: default:
                        reachableStates = mdpGraph.outgoingEdgesOf(Long.parseLong(stateID))
                                .stream()
                                .map(mdpGraph::getEdgeTarget)
                                .filter(stateId -> relevantStates.contains(stateId))
                                .collect(Collectors.toSet());
                }

                for (Long idReachableState : reachableStates) {
                    if (!(visited.contains(idReachableState) || visiting.contains(idReachableState))){
                        toVisit.add(String.valueOf(idReachableState));
                    }
                }
            }

            visited.addAll(visiting);
            visiting = toVisit;
            distance++;
        }

        Set<Long> not_reachable = new HashSet<>(model.getAllStates())
                .stream()
                .filter(stateId -> relevantStates.contains(stateId))
                .collect(Collectors.toSet());
        not_reachable.removeAll(visited);
//            if (direction == DistanceDirection.REACHABLE) {
//                switch
//            }

        for (long stateID : not_reachable){
            String reachability = semiGrouping ? "inf" : ENTRY_C_BLANK;
            toExecute.add(String.format("UPDATE %s SET %s = '%s' WHERE %s = '%s'", model.getStateTableName(), getCollumn(), reachability, ENTRY_S_ID, stateID));
        }

        return toExecute;
    }

    @Override
    public String getCollumn() {
        return String.format("%s_%s", ViewType.DistanceView.name(), dbColumnId);
    }

    public boolean match(String expression, long granularity) {
        return this.identifierExpression.equals(expression) & (this.granularity == granularity);
    }
}
