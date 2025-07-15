Requirements: 
- NodeJS v. 20+: `https://nodejs.org/en/download/package-manager`

How to run: 
- `npm install` brings all dependencies. 
- `npm run dev` enables http://localhost:3000/ that can be opened in the browser. 
- `npm run build` creates static files on `/dist`. 

Development: 
- we're moving towards a static website (no server).
- currently, only cross-tab communication (`socket.io`) needs a server (see `vite.config.ts`). 
- the code is in `/src`, but the html is at `./` (see `index.html`, `/overview`).
