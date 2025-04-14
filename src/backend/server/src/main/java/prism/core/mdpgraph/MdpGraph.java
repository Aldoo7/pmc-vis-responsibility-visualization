package prism.core.mdpgraph;

import org.jgrapht.graph.DirectedWeightedPseudograph;
import prism.api.State;
import prism.api.Transition;
import prism.core.Project;
import prism.db.PersistentQuery;
import prism.db.mappers.StateMapper;
import prism.db.mappers.TransitionMapper;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

public class MdpGraph extends DirectedWeightedPseudograph<Long,Long> {

    private Map<Long, MdpState> longToObjStates = new HashMap<>();
    private Map<Long, MdpTransition> longToObjTrans = new HashMap<>();

    public MdpGraph(Project model) {
        super(Long.class);
        try(PersistentQuery query = model.getDatabase().openQuery(String.format("SELECT * FROM %s", model.getStateTableName()))) {
            Iterator<State> states = query.iterator(new StateMapper(model, null));
            while (states.hasNext()) {
                State state = states.next();
                MdpState mdpState = new MdpState(state);
                //longToObjStates.put(state.getNumId(), mdpState);
                //addVertex(state.getNumId());
            }
        }

        // iterate over all outgoing transitions
        Long mdpTransLeanId = 0L;

        try(PersistentQuery query = model.getDatabase().openQuery(String.format("SELECT * FROM %s", model.getTransitionTableName()))){
            Iterator<Transition> transitions = query.iterator(new TransitionMapper(model));
            while(transitions.hasNext()){
                Transition trans = transitions.next();
                Long sourceState = Long.parseLong(trans.getSource());
                Set<String> targetStatesString = trans.getProbabilityDistribution().keySet();

                // iterate over all targets of transitions
                for (String targetStateString : targetStatesString) {
                    double probability = trans.getProbabilityDistribution().get(targetStateString);
                    if (probability == 0) continue;
                    Long targetState = Long.parseLong(targetStateString);
                    MdpTransition mdpTransLean = new MdpTransition(
                            mdpTransLeanId,
                            0L, //trans.getNumId(),
                            sourceState,
                            targetState,
                            trans.getAction()
                    );
                    longToObjTrans.put(mdpTransLeanId, mdpTransLean);
                    addEdge(sourceState, targetState, mdpTransLeanId);
                    setEdgeWeight(sourceState, targetState, probability);
                    mdpTransLeanId++;

                    // TODO remove, only for Performance testing of ReachabilityView
                    if (trans.getAction().equals("end")) {
                        longToObjStates.get(sourceState).setFinal();
                    }

                }
            }
        }


    }

    public boolean addTransition(Long sourceState, Long targetState, Long transId) {
        return addEdge(sourceState, targetState, transId);
    }

    public Set<Long> stateSet() {
        return vertexSet();
    }

    public MdpTransition getTransObj(Long mdpTransLeanId) { return longToObjTrans.get(mdpTransLeanId); }

    public MdpState getStateObj(Long stateId) { return longToObjStates.get(stateId); }
}
