# Loopatron 5000 (LT5K)

**Note: this is not even alpha. If you think it's cool, please feel free to make PRs. If you use it, let me know! - EF 2022-10-21**

LT5K is a modular library for building syncronized, loop-based patterns for animation and sound generation in JavaScript.

# Demos

- [Kitchen Sink Canvas Demo](./examples/demo-kitchensink.html)

# Structure

```
LoopatronArrangement
    - syncStep
    - LoopatronRenderer[]
        - valueFunction -- function that returns a value
        - renderFunction -- function that takes a value and does something with it
        - renderTarget -- the target of the renderFunction
```
