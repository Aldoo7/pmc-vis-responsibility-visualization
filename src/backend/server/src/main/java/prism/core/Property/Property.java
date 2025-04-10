package prism.core.Property;

import org.jdbi.v3.core.result.ResultIterator;
import parser.VarList;
import parser.ast.*;
import parser.type.TypeDouble;
import prism.Pair;
import prism.PrismException;
import prism.api.Transition;
import prism.api.VariableInfo;
import prism.core.Namespace;
import prism.core.Project;
import prism.core.Scheduler.Scheduler;
import prism.db.Batch;
import prism.db.PersistentQuery;
import prism.db.mappers.EntryMapper;
import prism.db.mappers.PairMapper;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.sql.SQLException;
import java.util.*;
import java.util.stream.Collectors;

public abstract class Property implements Namespace {

    protected int id;

    protected Project project;
    protected String name;
    protected Expression expression;
    protected PropertiesFile propertiesFile;

    protected boolean minimum = false;

    protected boolean alreadyChecked = false;

    protected Scheduler scheduler = null;

    public Property(Project project, int id, PropertiesFile propertiesFile, parser.ast.Property prismProperty){
        this.project = project;
        this.id = id;
        this.name = prismProperty.getName() != null ? prismProperty.getName() : prismProperty.getExpression().toString();
        this.expression = prismProperty.getExpression();
        this.propertiesFile = propertiesFile;

        Map<String, VariableInfo> info = (Map<String, VariableInfo>) project.getInfo().getStateEntry(OUTPUT_RESULTS);

        if (project.getDatabase().question(String.format("SELECT name FROM pragma_table_info('%s') WHERE name = '%s'", project.getStateTableName(), this.getPropertyCollumn()))) {
            alreadyChecked = true;
            info.put(this.name, this.getPropertyInfo());
        }else{
            info.put(this.name, VariableInfo.blank(this.name));
        }
        project.getInfo().setStateEntry(OUTPUT_RESULTS, info);
        project.getInfo().setTransitionEntry(OUTPUT_RESULTS, info);
    }

    protected VariableInfo getPropertyInfo(){
        Optional<Double> out = project.getDatabase().executeLookupQuery(String.format("SELECT MAX(%s) FROM %s", this.getPropertyCollumn(), project.getStateTableName()), Double.class);
        return new VariableInfo(this.name, VariableInfo.Type.TYPE_NUMBER, 0, Math.ceil(out.orElse(0.0)));
    }

    public static Property createProperty(Project project, int id, PropertiesFile propertiesFile, parser.ast.Property prismProperty){
        Expression expression = prismProperty.getExpression();

        // P operator
        if (expression instanceof ExpressionProb) {
            return new Probability(project, id, propertiesFile, prismProperty);
        }
        // R operator
        else if (expression instanceof ExpressionReward) {
            try {
                return new Expectation(project, id, propertiesFile, prismProperty, ((ExpressionReward) expression).getRewardStructIndexByIndexObject(project.getModulesFile().getRewardStructNames(), project.getModulesFile().getConstantValues()));
            } catch (PrismException e) {
                return new Expectation(project, id, propertiesFile, prismProperty);
            }
            // Fallback (should not happen)
        }else{
            throw new RuntimeException(String.format("Expression %s not understood", expression));
        }
    }

    public Map<Long, Double> getPropertyMap() {
        List<Pair<Long, Double>> list = project.getDatabase().executeCollectionQuery(String.format("SELECT %s, %s FROM %s", ENTRY_S_ID, getPropertyCollumn(), project.getStateTableName()), new EntryMapper(getPropertyCollumn()));
        Map<Long, Double> out = new HashMap<>();
        for (Pair<Long, Double> p : list){
            out.put(p.getKey(), p.getValue());
        }
        return out;
    }

    public int getID() {return id;}

    public String getName() {return name;}

    public String getPropertyCollumn(){
        return ENTRY_PROP + id;
    }

    public String getSchedulerCollumn(){
        return ENTRY_SCHED + id;
    }

    public Scheduler getScheduler(){
        return this.scheduler;
    }

    public void clear(){
        this.alreadyChecked = false;
        Map<String, VariableInfo> info = (Map<String, VariableInfo>) project.getInfo().getStateEntry(OUTPUT_RESULTS);
        info.replace(this.name, VariableInfo.blank(this.name));
        project.getInfo().setStateEntry(OUTPUT_RESULTS, info);
        project.getInfo().setTransitionEntry(OUTPUT_RESULTS, info);
    }

    public abstract VariableInfo modelCheck() throws PrismException;

    public void printScheduler(String filename, boolean limit) {
        File f = new File(filename);
        ModulesFile modulesFile = project.getModulesFile();
        String state_table = project.getStateTableName();

        if (limit){
            try {
                state_table = this.createReachableTable();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }

        int size = project.getDatabase().executeLookupQuery(String.format("SELECT COUNT(*) FROM %s", state_table), Integer.class).orElse(0);

        try(BufferedWriter writer = new BufferedWriter(new FileWriter(f))) {
            //HEADER
            VarList varList = modulesFile.createVarList();
            writer.write(String.format("%s;", varList.getNumVars()));
            System.out.printf("%s;", varList.getNumVars());
            StringBuffer joins = new StringBuffer();
            StringBuffer order = new StringBuffer();
            for (int i = 0; i < varList.getNumVars();i++){
                joins.append(String.format("LEFT JOIN (SELECT * FROM split WHERE colNum=%s) as split%s ON %s.ROWID = split%s.string_id\n", i+1, i+1, state_table, i+1));
                order.append(String.format("CAST(split%s.value AS INTEGER), \n", i+1));

                writer.write(String.format("%s[%s..%s];", varList.getName(i), varList.getLow(i), varList.getHigh(i)));
                System.out.printf("%s[%s..%s];", varList.getName(i), varList.getLow(i), varList.getHigh(i));
            }
            writer.write(String.format("%s;%s;%s", modulesFile.getSynchs().size(), modulesFile.getSynchs().stream().map(s -> "[" + s + "]").collect(Collectors.joining(";")), size));
            System.out.printf("%s;%s;%s\n", modulesFile.getSynchs().size(), modulesFile.getSynchs().stream().map(s -> "[" + s + "]").collect(Collectors.joining(";")), size);
            //BODY
            writer.newLine();

            String transitionQuery = String.format(
                    "WITH RECURSIVE split(string_id, value, str, colNum) AS ( \n" +
                            "WITH const AS (SELECT ';' AS delimiter)\n" +
                            "    SELECT %s.ROWID, '', %s||delimiter, 0 FROM %s, const\n" +
                            "    UNION ALL SELECT\n" +
                            "    string_id,\n" +
                            "    substr(str, 0, instr(str, delimiter)),\n" +
                            "    substr(str, instr(str, delimiter) + length(delimiter)),\n" +
                            "    colNum+1\n" +
                            "    FROM split,const WHERE str!=''\n" +
                            ") \n" +
                            "SELECT %s, GROUP_CONCAT(%s, ';') AS actions \n" +
                            "FROM %s\n" +
                            "%s\n" +
                            "JOIN %s ON %s = %s \n" +
                            "WHERE %s = 1 GROUP BY %s\n" +
                            "ORDER BY %s %s"
                    , state_table
                    , ENTRY_S_NAME
                    , state_table
                    , ENTRY_S_NAME
                    , ENTRY_T_ACT
                    , state_table
                    , joins.toString()
                    , project.getTransitionTableName()
                    , ENTRY_S_ID
                    , ENTRY_T_OUT
                    , this.getSchedulerCollumn()
                    , ENTRY_S_NAME
                    , order.toString()
                    , ENTRY_S_NAME);

            try(PersistentQuery query = project.getDatabase().openQuery(transitionQuery); ResultIterator<Pair<String, String>> it = query.iterator(new PairMapper<>(ENTRY_S_NAME, "actions", String.class, String.class))) {
                while (it.hasNext()) {
                    Pair<String, String> out = it.next();
                    String s = String.format("%s;%s", out.getKey(), String.join(";", out.getValue()));
                    writer.write(s);
                    writer.newLine();
                }
            }
        } catch (IOException | PrismException e) {
            throw new RuntimeException(e);
        } finally {
            try {
                if (limit) this.removeReachableTable(state_table);
            } catch (SQLException e) {
                throw new RuntimeException(e);
            }
        }
    }

    private String createReachableTable() throws Exception {
        Set<Long> visited = new HashSet<>();
        Set<Long> visiting = new HashSet<>();
        visiting.addAll(project.getInitialStates());
        String table_name = project.getStateTableName() + "_reach";

        Map<Long, List<Transition>> outgoing = new HashMap<>();

        for (Transition t : project.getAllTransitions()){
            long s_id = Long.parseLong(t.getSource());
            if (!outgoing.containsKey(s_id)){
                outgoing.put(s_id, new ArrayList<>());
            }
            outgoing.get(s_id).add(t);
        }


        project.getDatabase().execute(String.format("CREATE TABLE %s (%s INTEGER PRIMARY KEY NOT NULL, %s TEXT, %s BOOLEAN)", table_name, ENTRY_S_ID, ENTRY_S_NAME, ENTRY_S_INIT));

        String stateInsertCall = String.format("INSERT INTO %s SELECT %s,%s,%s FROM %s WHERE %s = ?", table_name, ENTRY_S_ID, ENTRY_S_NAME, ENTRY_S_INIT, project.getStateTableName(), ENTRY_S_ID);

        try(Batch toExecute = project.getDatabase().createBatch(stateInsertCall, 1)){
            while(!visiting.isEmpty()){
                Set<Long> toVisit = new HashSet<>();

                for (Long stateID : visiting){
                    toExecute.addToBatch(String.valueOf(stateID));

                    //See all outgoing
                    List<Transition> out = outgoing.get(stateID);
                    for (Transition vert : out){
                        if (vert.getScheduler().get(this.getName()) > 0){
                            for (String reachable : vert.getProbabilityDistribution().keySet()){
                                long r = Long.parseLong(reachable);
                                if (!(visited.contains(r) | visiting.contains(r))){
                                    toVisit.add(r);
                                }
                            }
                        }
                    }
                }

                visited.addAll(visiting);
                visiting = toVisit;
            }
        }

        return table_name;
    }

    private void removeReachableTable(String state_table) throws SQLException {
        project.getDatabase().execute(String.format("DROP TABLE IF EXISTS %s", state_table));
    }
}
