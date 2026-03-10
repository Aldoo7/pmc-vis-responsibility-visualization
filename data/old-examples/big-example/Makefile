default: xprism
.PHONY: clean xprism results

PROPS ?= main.props
MODEL ?= main.profeat

xprism: translated/sim.prism
	xprism translated/sim.prism translated/out.props

translated/sim.prism: translated/out.prism
	./initialize.sh translated/out.prism translated/sim.prism

translated/out.prism:
	mkdir -p translated
	profeat ${MODEL} ${PROPS} -o translated/out.prism -p translated/out.props -t

results:
	mkdir -p translated
	mkdir -p results
	./profeat_parallel.sh ${MODEL} ${PROPS}

clean:
	rm -r translated results
