package prism.responsibility;

import org.junit.Test;
import static org.junit.Assert.*;

public class ResponsibilityEngineConfigTest {

    @Test
    public void testDefaultsReflectedInOutput() throws Exception {
        ResponsibilityEngine engine = new ResponsibilityEngine("mock");
        ResponsibilityOutput out = engine.compute("two_dice", "Pmax=?[F error]", 0);
        assertEquals("optimistic", out.getResponsibilityType());
        assertEquals("shapley", out.getPowerIndex());
    }

    @Test
    public void testOverridesReflectedInOutput() throws Exception {
        ResponsibilityEngine engine = new ResponsibilityEngine("mock");
        engine.setMode("pessimistic");
        engine.setPowerIndex("banzhaf");
        ResponsibilityOutput out = engine.compute("two_dice", "Pmax=?[F error]", 0);
        assertEquals("pessimistic", out.getResponsibilityType());
        assertEquals("banzhaf", out.getPowerIndex());
    }
}
