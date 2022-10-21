# Loopatron 5000 (LT5K)

**Note: this is not even alpha. If you think it's cool, please feel free to make PRs. If you use it, let me know! - EF 2022-10-21**

LT5K is a modular library for building syncronized, loop-based patterns for animation and sound generation in JavaScript.

![README-demo](./README-demo.gif)

# Demos

To view demos, you'll want to run a web server. I use [live-server](https://www.npmjs.com/package/live-server) for this.  If you do not already have it or a similar program installed, do the following:

```bash
npm install -g live-server
```

Then, from the root of the LT5K, run:

```bash
live-server ./
```

`live-server` will probably say something like:

```bash
Serving "./" at http://127.0.0.1:8080
Ready for changes
```

and then open a browser window to that URL.  You can then navigate to the `examples` directory and click on the demo you want to see.

- [Kitchen Sink Canvas Demo](http://127.0.0.1:8080/examples/demo-kitchensink.html)

# Structure

```
LoopatronArrangement
    - syncStep
    - LoopatronRenderer[]
        - valueFunction -- function that returns a value
        - renderFunction -- function that takes a value and does something with it
        - renderTarget -- the target of the renderFunction
```
