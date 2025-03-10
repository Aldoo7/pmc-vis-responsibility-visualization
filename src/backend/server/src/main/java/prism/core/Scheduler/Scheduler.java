package prism.core.Scheduler;

import prism.core.Project;

import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

import static prism.core.Namespace.*;

public class Scheduler {

    private final int id;
    private final String name;


    private Scheduler(String name, int id){
        this.name = name;
        this.id = id;
    }

    public static Scheduler createScheduler(Project project, String name, int id, List<Criteria> criterias) throws SQLException {
        String table = project.getTransitionTableName();
        String schedTable = project.getSchedulerTableName();

        Optional<String> entry = project.getDatabase().executeLookupQuery(String.format("SELECT %s FROM %s WHERE %s = '%s'", ENTRY_SCH_NAME, schedTable, ENTRY_SCH_ID, id), String.class);

        if(entry.isPresent()){
            if (entry.get().equals(name)){
                return loadScheduler(name, id);
            }else{
                return createScheduler(project, name, id+1, criterias);
            }
        }

        String partition = ENTRY_T_OUT;
        StringBuilder order;
        if (criterias == null || criterias.isEmpty()){
             order = new StringBuilder(ENTRY_T_ACT + " " + "ASC");
        }else{
            order = new StringBuilder(criterias.get(0).getOrder());
            for (int i = 1; i < criterias.size(); i++){
                order.append(", ").append(criterias.get(i).getOrder());
            }
        }
        String scheduler_collumn = ENTRY_SCHED + id;

        String creationQuery = String.format("ALTER TABLE %s ADD COLUMN %s NOT NULL DEFAULT 0", table, scheduler_collumn);
        String updateQuery = String.format("WITH cte AS (SELECT *, dense_rank() OVER(PARTITION BY %s ORDER BY %s) AS r FROM %s) UPDATE %s SET %s=1 WHERE %s IN (SELECT %s FROM cte WHERE r=1)", partition, order, table, table, scheduler_collumn, ENTRY_T_ID, ENTRY_T_ID);
        String infoQuery = String.format("INSERT INTO %s (%s, %s) VALUES(%s, '%s')", schedTable, ENTRY_SCH_ID, ENTRY_SCH_NAME, id, name);

        project.getDatabase().execute(creationQuery);
        project.getDatabase().execute(updateQuery);
        project.getDatabase().execute(infoQuery);

        return new Scheduler(name, id);
    }

    public static Scheduler loadScheduler(String name, int id){
        return new Scheduler(name, id);
    }

    public String getName() {
        return name;
    }

    public int getId() {
        return id;
    }

    public String getCollumnName(){
        return ENTRY_SCHED + id;
    }
}
