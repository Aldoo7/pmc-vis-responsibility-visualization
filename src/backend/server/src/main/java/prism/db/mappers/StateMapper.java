package prism.db.mappers;

import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;
import prism.PrismLangException;
import prism.api.State;
import prism.core.Namespace;
import prism.core.Project;
import prism.core.View.View;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * Maps database output to Node Objects
 */
public class StateMapper implements RowMapper<State> {

    private final List<View> views;
    private final Project project;

    private final ViewMapper viewMapper;

    private final PropertyMapper propertyMapper;

    private final RewardMapper rewardMapper;


    public StateMapper(Project project, List<View> views) {
        this.project = project;
        this.views = views;
        this.viewMapper = new ViewMapper();
        this.propertyMapper = new PropertyMapper(project.getProperties());
        this.rewardMapper = new RewardMapper(project);
    }

    @Override
    public State map(final ResultSet rs, final StatementContext ctx) throws SQLException {
        if (views == null) {
            try {
                return new State(rs.getString(Namespace.ENTRY_S_ID), rs.getString(Namespace.ENTRY_S_NAME), project.getModelParser().parseParameters(rs.getString(Namespace.ENTRY_S_NAME)), project.getLabelMap(project.getModelParser().parseState(rs.getString(Namespace.ENTRY_S_NAME))), rewardMapper.map(rs, ctx), propertyMapper.map(rs, ctx));
            }catch (PrismLangException e) {
                return new State(rs.getString(Namespace.ENTRY_S_ID), rs.getString(Namespace.ENTRY_S_NAME), new TreeMap<>(), new TreeMap<>(), rewardMapper.map(rs, ctx), propertyMapper.map(rs, ctx));
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        return new State(rs.getString(Namespace.ENTRY_C_NAME), views.stream().map(c -> Long.toString(c.getId())).collect(Collectors.toList()), viewMapper.map(rs, ctx));
    }
}
