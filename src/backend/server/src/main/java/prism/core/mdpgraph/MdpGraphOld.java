package prism.core.mdpgraph;

import org.jgrapht.graph.DirectedWeightedPseudograph;
import prism.api.State;
import prism.api.Transition;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Representation of MDP as graph object using jgrapht
 * Currently a no further functionality -> directed weighted pseudo graph could be used directly also
 * Have not thought about that, but left it this way for adaptability purposes
 * ALTERNATIVE: Use directed weighted pseudo graph directly and move content of constructor into a new function of model
 */

public class MdpGraphOld extends DirectedWeightedPseudograph<State, MdpTransitionOld> {

    public MdpGraphOld(List<State> states, List<Transition> transitions) {
        super(MdpTransitionOld.class);

        // add all states as vertices
        for (State state : states) {
            addVertex(state);
        }

//        ATTEMPT TO USE BINARY SEARCH
//        states.sort(Comparator.comparing(State::getId));
//
//        for (Transition transition : transitions) {
//            List<String> targetStrings = new ArrayList<>(transition.getProbabilityDistribution().keySet());
//            targetStrings.sort(Comparator.naturalOrder());
//
//        }
//
//        for (Transition transition : transitions) {
//
//            State source = states[Collections.binarySearch(states, state, Comparator.comparing(State::getId))];
//
//        }

        // add all transitions
        for (Transition transition : transitions) {
            State source = null;

            // add edge for each probability value (as in definition of MDP)
            // iterate over all the targetsStrings to find corresponding state object
            for (String targetString : transition.getProbabilityDistribution().keySet()) {
                State target = null;
                String sourceString = transition.getSource();

                // target == null for performance (no string comparison once found)
                for (State state : states) {
                    if (target == null && state.getId().equals(targetString)) {
                        target = state;
                    }

                    // also determine source (just once per transition)
                    if (source == null && state.getId().equals(sourceString)) {
                        source = state;
                    }
                    if (source != null && target != null) {
                        break;
                    }
                }
                MdpTransitionOld mdpTransitionOld = new MdpTransitionOld(
                        0L,//transition.getNumId(),
                        source,
                        target,
                        transition.getAction(),
                        transition.getResults(),
                        transition.getScheduler()
                );
                addEdge(source, target, mdpTransitionOld);
                setEdgeWeight(mdpTransitionOld, transition.getProbabilityDistribution().get(targetString));
            }
        }
    }

    public Set<State> stateSet() {
        return vertexSet();
    }

    public List<State> getAllStates() {
        return new ArrayList<>(vertexSet());
    }

}
