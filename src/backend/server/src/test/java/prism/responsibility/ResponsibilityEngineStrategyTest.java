package prism.responsibility;

import org.junit.Test;
import static org.junit.Assert.*;

public class ResponsibilityEngineStrategyTest {

    @Test
    public void optimisticUsesOptimisticType() throws Exception {
        ResponsibilityEngine engine = new ResponsibilityEngine("mock");
        engine.setMode("optimistic");
        ResponsibilityOutput out = engine.compute("model", "Pmax=?[F error]", 0);
        assertEquals("optimistic", out.getResponsibilityType());
    }

    @Test
    public void pessimisticUsesPessimisticType() throws Exception {
        ResponsibilityEngine engine = new ResponsibilityEngine("mock");
        engine.setMode("pessimistic");
        ResponsibilityOutput out = engine.compute("model", "Pmax=?[F error]", 0);
        assertEquals("pessimistic", out.getResponsibilityType());
    }
}
