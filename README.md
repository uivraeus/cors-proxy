# Simple (limited) CORS proxy
This proxy only supports GET requests and only forward the "accept" header.

It will not proxy any requests for which the "origin" header is not provided.

> Why not use the popular [cors-anywhere](https://github.com/Rob--W/cors-anywhere) instead?
> - No reason really... it is probably better to use that library.


