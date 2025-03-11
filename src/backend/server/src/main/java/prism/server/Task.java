package prism.server;

public interface Task extends Runnable {

    public enum Type {Build, Check, Misc}

    public String status();

    public String name();

    public Type type();

    public String projectID();
}
