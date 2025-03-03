package prism.core.View;

import prism.api.State;
import prism.core.Project;
import prism.db.PersistentQuery;
import prism.db.mappers.StateMapper;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.List;


/**
 * View that views all states with the same atomic propositions (or as prism calls them, labels) together.
 */
public class APView extends View {

    public APView(Project parent, long id){
        super(parent, ViewType.APView, id);
    }
    public APView(Project parent, long id, Collection<String> attributeSetter) throws Exception {
        super(parent, ViewType.APView, id, attributeSetter);
    }

    @Override
    protected List<String> groupingFunction() throws Exception {
        List<String> toExecute = new ArrayList<>();

        try(PersistentQuery query = model.getDatabase().openQuery(String.format("SELECT * FROM %s", model.getStateTableName()))) {
            Iterator<State> states = query.iterator(new StateMapper(model, null));
            while (states.hasNext()) {
                State state = states.next();
                if (!relevantStates.contains(state.getNumId())) continue;
                String combination = String.join(";", model.getLabels(model.getModelParser().parseState(state.getParameterString())));
//            combination = semiGrouping && combination.isEmpty() ? ENTRY_C_BLANK : combination;
                toExecute.add(String.format("UPDATE %s SET %s = '%s' WHERE %s = '%s'", model.getStateTableName(), getCollumn(), combination, ENTRY_S_ID, state.getNumId()));

            }
        }
//        List<State> states = model.getStates(model.getAllStates())
//                .stream()
//                .filter(state -> relevantStates.contains(state.getNumId()))
//                .collect(Collectors.toList());
//
//        for (State state : states) {
//            String combination = String.join(";", model.getLabels(model.parseState(state.getVariableString())));
////            combination = semiGrouping && combination.isEmpty() ? ENTRY_C_BLANK : combination;
//            toExecute.add(String.format("UPDATE %s SET %s = '%s' WHERE %s = '%s'", model.getStateTableName(), getCollumn(), combination, ENTRY_S_ID, state.getNumId()));
//        }

        return toExecute;
    }

    @Override
    public String getCollumn() {
        return ViewType.APView.name();
    }

}
