package prism.db.mappers;

import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;
import prism.core.Namespace;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;


/**
 * Maps database outputs for views content. Needed since we need to map a string output to a List of longs
 */
public class DistributionMapper implements RowMapper<Map<String, Double>> {

    @Override
    public Map<String, Double> map(ResultSet rs, StatementContext ctx) throws SQLException {
        double roundingFactor = 1000;
        String out = rs.getString(Namespace.ENTRY_T_PROB);
        Map<String, Double> ret = new HashMap<>();
        if (out == null) return ret;
        for (String entry : out.split(";")){
            String[] e = entry.split(":");
            if (e.length != 2){
                throw new SQLException();
            }
//            double doubleVal = Double.parseDouble(e[1]);
//            doubleVal = ((double)Math.round(doubleVal*roundingFactor))/roundingFactor;
//            System.out.println(doubleVal);
            ret.put(e[0], Double.parseDouble(e[1]));
        }
        return ret;
    }
}
