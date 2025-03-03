package prism.misc;

import java.util.concurrent.TimeUnit;

public class Debug {
    public static void sleep(long seconds) throws InterruptedException {
        TimeUnit.SECONDS.sleep(seconds);
    }
}
