export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname

  if (/^\/[\w.-]+\.worker-[\w-]+\.js\.map$/.test(pathname)) {
    event.node.res.statusCode = 204
    return event.node.res.end()
  }
})
