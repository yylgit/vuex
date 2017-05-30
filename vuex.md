index.js是入口文件
```
import { Store, install } from './store'
import { mapState, mapMutations, mapGetters, mapActions } from './helpers'

export default {
  Store,
  install,
  version: '__VERSION__',
  mapState,
  mapMutations,
  mapGetters,
  mapActions
}
```
#### 1 挂载
当调用vue.use方法的时候，会调用对象的install方法，通过applyMixin方法将store注入到每一个vue实例中，
```
export function install (_Vue) {
  if (Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}

// auto install in dist mode
//如果window上有Vue则自动安装
if (typeof window !== 'undefined' && window.Vue) {
  install(window.Vue)
}

```
```
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  /**
   * 如果是2.x.x以上版本，可以使用 hook 的形式进行注入，或使用封装并替换Vue对象原型的_init方法，实现注入。
   */
  //Vue2 通过Vue组件的init方法或者beforeCreate方法
  if (version >= 2) {
    const usesInit = Vue.config._lifecycleHooks.indexOf('init') > -1
    Vue.mixin(usesInit ? { init: vuexInit } : { beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    //因为Vue的构造函数会调用_init方法
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   * 将初始化Vue根组件时传入的store设置到this对象的$store属性上，子组件从其父组件引用$store属性，层层嵌套进行设置。在任意组件中执行 this.$store 都能找到装载的那个store对象
   */

  function vuexInit () {
    const options = this.$options
    // store injection
    if (options.store) {
      this.$store = options.store
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}

```

#### 重点是Store对象
在创建store对象的时候，我们需要传入state，getter，mutation，action，但是store对象还复杂在处理多个模块有命名空间的情况。
先考虑没有命名空间的情况。

#####1 state和getter怎么存放
利用的是Vue对象进行存储，将state放在data中，将定义的getter映射成Vue对象的computed属性。最终将设个对象挂载store的_vm属性上，
获取store.state
```
 get state () {
    return this._vm._data.$$state
  }
```
设置getters对象
```
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    //将getter存到computed对象中，然后给_vm，利用的vm计算属性的缓存机制
    computed[key] = () => fn(store)
    //给store对象设置getters属性
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],//store的getters取_vm的计算属性
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
}

```
#####1 dispatch和commit
利用订阅和发布模式，将action和mutation分别存在_actions和_mutations中，然后用用dispatch和commit去发布。

##### module与namespace
当应用很复杂，state很多，并且互相之间关联不大的情况下，将store可以分模块和命名空间，分了命名空间以后他们之间就有了隔离，dispath和commit默认只能触发本命名空间下的action和mutation。
看vuex对于命名空间的实现。

首先是定义了一个module类，对原始module的封装，然后是ModuleCollection类，它是一个模块树，
```
//递归调用register，构造了一个module树
  register (path, rawModule, runtime = true) {
    if (process.env.NODE_ENV !== 'production') {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime)
    //根module
    if (path.length === 0) {
      this.root = newModule
    } else {
      //挂到父级module
      const parent = this.get(path.slice(0, -1))
      parent.addChild(path[path.length - 1], newModule)
    }

    // register nested modules
    //子module
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }
```
module树构造完成以后，在store中调用installModule方法，将模块中的getter，action和mutation都注册到store中，state是通过一个变量收集的。
在这个注册的过程中，如果这个module有命名空间，那么在getter。action和mutation在注册的过程中都会加上命名空间，加入命名空间是poi，那么所有的key前面都会加上 'poi/',例如 'poi/changeName'。同时dispatch、commit在触发的时候也会默认加上命名空间。但是会提供一个参数来判断是否使用全局的dispatch和commit。通过getter和mutation也会传入局部的state和全局的state
```
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  //注册state
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      Vue.set(parentState, moduleName, module.state)
    })
  }

  //创建命名空间下的context对象，包括state，getter，dispatch，commit
  const local = module.context = makeLocalContext(store, namespace, path)

  //mutations、actions以及getters注册
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => {
    const namespacedType = namespace + key
    registerAction(store, namespacedType, action, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  //递归安装子module
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

```
```
/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        //在type前面加上namespace，只触发该namespace的actions
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
         //在type前面加上namespace，只触发该namespace的mutation
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    //<2>local的state还是从store中取的state
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}
```
```
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload, cb) {
    let res = handler({
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}
```
### 是否能够直接修改store的state
- store的state属性用的是get方法，没有set方法，所以不能直接设置
- 利用commit触发mutation修改state的时候，是因为把state传给了mutation，但是在mutation触发state变化的时候，会触发this._committing = true
- 说以可以通过this._committing还判断时候是直接修改的store._vm._data.$$state
- 传给mutation的state和store._vm._data.$$state指向的是一个对象，所以修改mutation中的state，store._vm._data.$$state也会跟着改变，但是如果把state直接赋值一个新对象的话，那么store._vm._data.$$state将不会跟着变化。


#### state变化如何同步到视图中，将state映射到组件的computed属性中，当state变化时，computed属性也变化。