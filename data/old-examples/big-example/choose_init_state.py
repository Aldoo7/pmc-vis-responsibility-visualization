import sys
import re

pattern_1 = re.compile("^\s*\((.+)\) & (.+)\s*$")
pattern_1_1 = re.compile("^\s*(\w+) = (\w+)\s*$")
pattern_1_2 = re.compile("^\s*\(?\s*(\d+)\s*<=\s*(\w+)\s*&\s*(\w+)\s*<=\s*(\d+)\s*\)?\s*$")
pattern_2 = re.compile("(global)?\s*(\w+)\s*:\s*((bool)|(\[(.+)\s*\.\.\s*.+\]));")

def merge_two_dicts(x, y):
    z = x.copy()
    z.update(y)
    return z

def split_brackets(line):
    line = line.strip()
    count = 0
    p = -1
    for pos in range(0, len(line)-1):
        if line[pos] == "(":
            count += 1
        if line[pos] == ")":
            count -= 1
        if count == 0:
            p = pos
            break
    if p < 1:
        return None
    else:
        first = line[1:p].strip()
        p2 = line.find("&", p+1)
        second = line[p2+1:].strip()
        return (first, second)


def parse_init(line):
    m = split_brackets(line)
    if m:
        rest = m[0]
        dic = parse_init(rest)
        m2 = pattern_1_1.match(m[1])
        if m2:
            var = m2.group(1).strip()
            val = m2.group(2).strip()
            dic[var] = val
        else:
            m3 = pattern_1_2.match(m[1])
            if m3:
                if (m3.group(2).strip() == m3.group(3).strip()) and (m3.group(1).strip() == m3.group(4).strip()):
                    var = m3.group(2).strip()
                    val = m3.group(1).strip()
                    dic[var] = val

        return dic
    else:
        dic = dict()
        m2 = pattern_1_1.match(line)
        if m2:
            var = m2.group(1).strip()
            val = m2.group(2).strip()
            dic[var] = val
        else:
            m3 = pattern_1_2.match(line)
            if m3:
                if (m3.group(2).strip() == m3.group(3).strip()) and (m3.group(1).strip() == m3.group(4).strip()):
                    var = m3.group(2).strip()
                    val = m3.group(1).strip()
                    dic[var] = val

        return dic

def main():
    file = sys.argv[1]
    target = sys.argv[2]
    dic = dict()

    with open(file, "r") as f:
        startinit = False
        for line in f:
            if line.startswith("init") and not startinit:
                startinit = True
            else:
                if startinit:
                    if line.startswith("endinit"):
                        startinit = False
                    else:
                        dic = merge_two_dicts(parse_init(line), dic)

    with open(file, "r") as f:
        with open(target, "w") as t:
            startinit = False
            for line in f:
                if line.startswith("init") and not startinit:
                    startinit = True
                if not startinit:
                    m = pattern_2.search(line)
                    if m:
                        name = m.group(2)
                        if m.group(1):
                            if dic.get(name):
                                t.write("{} {} : {} init {};\n".format(m.group(1),name, m.group(3), dic.get(name)))
                            else:
                                if m.group(4):
                                    t.write("{} {} : {} init false;\n".format(m.group(1), name, m.group(4)))
                                else:
                                    t.write("{} {} : {} init {};\n".format(m.group(1), name, m.group(3), m.group(6)))
                        else:
                            if dic.get(name):
                                t.write("{} : {} init {};\n".format(name, m.group(3), dic.get(name)))
                            else:
                                if m.group(4):
                                    t.write("{} : {} init false;\n".format(name, m.group(4)))
                                else:
                                    t.write("{} : {} init {};\n".format(name, m.group(3), m.group(6)))

                    else:
                        t.write(line)
                else:
                    if line.startswith("endinit"):
                        startinit = False


if __name__ == "__main__":
    main()
