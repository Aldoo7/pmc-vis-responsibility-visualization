package prism.db.mappers;

import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;
import prism.api.Pane;
import prism.core.Namespace;

import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * Maps database output to Node Objects
 */
public class PaneMapper implements RowMapper<Pane> {

    @Override
    public Pane map(final ResultSet rs, final StatementContext ctx) throws SQLException {
        return new Pane(rs.getString(Namespace.ENTRY_P_ID), rs.getString(Namespace.ENTRY_P_CONTENT));
    }
}
