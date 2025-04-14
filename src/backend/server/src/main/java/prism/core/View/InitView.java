package prism.core.View;

import prism.core.Project;

import java.util.*;

public class InitView extends View {

    public InitView(Project parent, long id){
        super(parent, ViewType.InitView, id, false);
    }
    public InitView(Project parent, long id, Collection<String> attributeSetter) throws Exception {
        super(parent, ViewType.InitView, id, attributeSetter);
//        setAndPutAtt("binaryMode", binaryMode);
        setAndPutAtt("semiGrouping", false);
    }

    @Override
    protected List<String> groupingFunction() throws Exception {
        List<String> toExecute = new ArrayList<>();

        // 1. Get initial states
        Set<String> initStates = new HashSet<>(model.getInitialStates());

        // Create views by checking if State is among initStates
        for (Long stateId : relevantStates) {
            boolean isInitState = initStates.contains(stateId.toString());
            String initGroupingString = calcBinGroupingString(isInitState, "init", "~init");

            toExecute.add(String.format("UPDATE %s SET %s = '%s' WHERE %s = '%s'", model.getStateTableName(), getCollumn(), initGroupingString, ENTRY_S_ID, stateId));
        }

        return toExecute;
    }

    @Override
    public String getCollumn() {
        return ViewType.InitView.name();
    }

}

