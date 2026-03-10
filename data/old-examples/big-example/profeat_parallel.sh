

MODEL=$1
PROPS=$2

profeat -t ${MODEL} ${PROPS} --one-by-one -o translated/out.prism -p translated/out.props
find translated/*.prism | parallel --eta "prism {} translated/out.props > results/{/.}.log"

#profeat -r results/out.csv --import-results translated/out.log
