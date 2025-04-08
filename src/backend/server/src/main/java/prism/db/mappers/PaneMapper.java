package prism.db.mappers;

import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;
import prism.PrismLangException;
import prism.api.Pane;
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
public class PaneMapper implements RowMapper<Pane> {

    @Override
    public Pane map(final ResultSet rs, final StatementContext ctx) throws SQLException {
        return new Pane(rs.getLong(Namespace.ENTRY_P_ID), rs.getString(Namespace.ENTRY_P_CONTENT));
    }
}
