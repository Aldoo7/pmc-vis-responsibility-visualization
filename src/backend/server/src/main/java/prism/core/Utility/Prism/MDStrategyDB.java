package prism.core.Utility.Prism;

import prism.Model;
import prism.Pair;
import prism.PrismException;
import prism.PrismLog;
import prism.core.Namespace;
import prism.db.Database;
import prism.db.mappers.PairMapper;
import strat.MDStrategy;
import strat.Strategy;
import strat.StrategyWithStates;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;

public class MDStrategyDB extends StrategyWithStates<Double> implements MDStrategy<Double>, Namespace {

    // Model associated with the strategy
    private Model model;
    // Other model info
    private int numStates;
    // Database Storing Scheduler Information
    private Database db;

    private final String choiceQuery;

    private final List<String> stateList;

    private final HashMap<Integer, List<String>> schedule;

    public MDStrategyDB(Model model, Database db, String table, String schedulerCollumn, boolean cache){
        this.model = model;
        numStates = (int) model.getNumStates();
        this.db = db;
        this.choiceQuery = String.format("SELECT %s FROM %s WHERE %s = 1 AND %s =", ENTRY_T_ACT, table, schedulerCollumn, ENTRY_T_OUT) + " %s LIMIT 1";
        this.stateList = model.getReachableStates().exportToStringList();

        if (cache){
            schedule = new HashMap<>();
            List<Pair<Integer, String>> lookup = db.executeCollectionQuery(String.format("SELECT %s, %s FROM %s WHERE %s = 1", ENTRY_T_ACT, ENTRY_T_OUT, table, schedulerCollumn), new PairMapper<>(ENTRY_T_OUT, ENTRY_T_ACT, Integer.class, String.class));
            for (Pair<Integer, String> entry : lookup){
                if (!schedule.containsKey(entry.first)){
                    schedule.put(entry.first, new ArrayList<>());
                }
                schedule.get(entry.first).add(entry.second.substring(1, entry.second.length()-1));
            }
        }else{
            schedule = null;
        }

        setStateLookUp(state -> {
            List<String> sl = stateList;
            return sl.indexOf(state.toStringNoParentheses());
        });
    }

    @Override
    public Object getChoiceAction(int s, int m)
    {
        if (schedule == null){
            Optional<String> action = db.executeLookupQuery(String.format(choiceQuery, s), String.class, false);
            return action.isPresent() ? action.get().substring(1, action.get().length()-1) : Strategy.UNDEFINED;
        }

        return schedule.get(s).get(0);
    }

    @Override
    public int getChoiceIndex(int s, int m)
    {
        throw new UnsupportedOperationException();
    }

    @Override
    public UndefinedReason whyUndefined(int s, int m)
    {
        return UndefinedReason.UNREACHABLE;
    }

    @Override
    public int getNumStates()
    {
        return numStates;
    }

    @Override
    public void exportInducedModel(PrismLog out) throws PrismException
    {
        throw new PrismException("Induced model construction not yet supported for symbolic engines");
    }

    @Override
    public void exportInducedModel(PrismLog out, int precision) throws PrismException
    {
        throw new PrismException("Induced model construction not yet supported for symbolic engines");
    }

    @Override
    public void exportDotFile(PrismLog out) throws PrismException
    {
        throw new PrismException("Strategy dot export not yet supported for symbolic engines");
    }

    @Override
    public void exportDotFile(PrismLog out, int precision) throws PrismException
    {
        throw new PrismException("Strategy dot export not yet supported for symbolic engines");
    }

    @Override
    public void clear()
    {

    }
}
