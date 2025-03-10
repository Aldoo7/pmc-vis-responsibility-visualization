function ndl_to_pcp(data, prop) {
    const returnable = { ps: [], psd: {} }
    returnable.ps = data.nodes.map(d => {
        const pcp_polyline = { id: d.id, color: d.type === 's' ? '--pcp-primary' : '--pcp-secondary' }
        
        Object.keys(prop).forEach(p => {

            Object.keys(prop[p].props).forEach(e => {
                if (prop[p].props[e]) {
                    pcp_polyline[e] = d.details[p][e];
                    if (!returnable.psd[e]) {
                        returnable.psd[e] = { 
                            type: prop[p].metadata[e].type,
                            min: prop[p].metadata[e].min,
                            max: prop[p].metadata[e].max,
                            prop: p, 
                        }
                    }        
                }
            });
        });
        
        return pcp_polyline;
    });

    return returnable;
}

export { ndl_to_pcp }; 