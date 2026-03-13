import { app } from './app.ts'
import { getServerEnv } from './env.ts'

const { PORT } = getServerEnv()

app.listen(PORT, () => {
  console.log(`HICH server listening on port ${PORT}`)
})
