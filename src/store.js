import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert } from './util'

//定义局部 Vue 变量，用于判断是否已经装载和减少全局作用域查找
let Vue // bind on install

export class Store {
  constructor (options = {}) {
    //已经执行安装函数进行装载；
    //支持Promise语法
    //必须用new操作符
    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `Store must be called with the new operator.`)
    }

    const {
      plugins = [],
      strict = false
    } = options

    let {
      state = {}
    } = options
    if (typeof state === 'function') {
      state = state()
    }

    // store internal state
    //是否正在commit
    this._committing = false
    this._actions = Object.create(null)
    this._mutations = Object.create(null)
    this._wrappedGetters = Object.create(null)
    this._modules = new ModuleCollection(options) // Vuex支持store分模块传入，存储分析后的modules
    this._modulesNamespaceMap = Object.create(null)  // 命名空间与对应模块的map
    this._subscribers = []   // 订阅函数集合，Vuex提供了subscribe功能
    this._watcherVM = new Vue()  // Vue组件用于watch监视变化

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this

    //封装替换原型中的dispatch和commit方法，将this指向当前store对象,当该方法不是使用store调用时，this仍然指向store
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    // state对象，经过installModule之后已经成了rootState
    resetStoreVM(this, state)

    // apply plugins
    plugins.concat(devtoolPlugin).forEach(plugin => plugin(this))
  }

  //取得this._vm._data.$$state
  get state () {
    return this._vm._data.$$state
  }
 
  //不能直接给state赋值
  set state (v) {
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `Use store.replaceState() to explicit replace store state.`)
    }
  }
  //对外提供的触发mutation的方法
  commit (_type, _payload, _options) {
    // check object-style commit
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    const entry = this._mutations[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    //执行注册的mutation，
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })
    //触发订阅者
    this._subscribers.forEach(sub => sub(mutation, this.state))

    if (
      process.env.NODE_ENV !== 'production' &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }
  //对外提供的触发action的方法
  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const entry = this._actions[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }
    //逐个执行action，返回promise
    return entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)
  }

  //订阅state变化的方法
  subscribe (fn) {
    const subs = this._subscribers
    if (subs.indexOf(fn) < 0) {
      subs.push(fn)
    }
    return () => {
      const i = subs.indexOf(fn)
      if (i > -1) {
        subs.splice(i, 1)
      }
    }
  }

  watch (getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  //替换全局的state
  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  //在store中注册新的模块
  registerModule (path, rawModule) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    //在模块树上进行注册
    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path))
    // reset store to update getters...
    //更新_vm，主要是更新state和getter
    resetStoreVM(this, this.state)
  }

  //卸载模块
  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    //模块树上卸载模块
    this._modules.unregister(path)
    this._withCommit(() => {
      //去掉state
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  //热更新store
  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

/**
 * 
 * 保存执行时的committing状态将当前状态设置为true后进行本次提交操作，待操作完毕后，将committing状态还原为之前的状态
 */
  _withCommit (fn) {
    // 保存之前的提交状态
    const committing = this._committing
     // 进行本次提交，若不设置为true，直接修改state，strict模式下，Vuex将会产生非法修改state的警告
    this._committing = true
    // 执行state的修改操作
    fn()
    // 修改完成，还原本次修改之前的状态
    this._committing = committing
  }
}

//重置store
function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

//创建store._vm对象
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    //将getter存到computed对象中，然后给_vm作为计算属性，利用了算属性的缓存机制
    computed[key] = () => fn(store)
    //设置store的getters,从_vm中取，也可以直接get： () => fn(store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true
  //利用install module之后得到的rootState和store._wrappedGetters得到的计算属性
  //创建Vue对象作为store._vm
  store._vm = new Vue({
    data: {
      $$state: state   //this.state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)
  }

  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}
//安装模块
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  if (module.namespaced) {
    //如果这个模块是有命名空间的，则将命名空间与模块之间的关系存入_modulesNamespaceMap
    store._modulesNamespaceMap[namespace] = module
  }

  //非根组件并且非热更新，热更新是用新的模块替换原来的模块
  if (!isRoot && !hot) {
    //根据path获取上一级state对象
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    //把模块的state设置在rootState树上
    store._withCommit(() => {
      //用Vue.set的原因是rootState最终设置成了vm对象的data属性，所以新添加的状态
      //要想是响应的就应该用Vue.set
      Vue.set(parentState, moduleName, module.state)
    })
  }

  //创建命名空间下的context对象，包括state，getter，dispatch，commit
  const local = module.context = makeLocalContext(store, namespace, path)

  //注册模块的mutation，action和getter到store中
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

  //递归安装子模块
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */
//根据命名空间来生成局部的上下文，包括type加上namespace的dispatch，commit，还有根据namespace获取的局部state和getter
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      //在!options.root的情况下type添加命名空间
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

      //在!options.root的情况下type添加命名空间
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

//生成命名空间下的getter，从store的getter中筛选前缀是namespace的属性
function makeLocalGetters (store, namespace) {
  const gettersProxy = {}

  const splitPos = namespace.length
  Object.keys(store.getters).forEach(type => {
    // skip if the target getter is not match this namespace
    if (type.slice(0, splitPos) !== namespace) return

    // extract local getter type
    const localType = type.slice(splitPos)

    // Add a port to the getters proxy.
    // Define as getter property because
    // we do not want to evaluate the getters in this time.
    Object.defineProperty(gettersProxy, localType, {
      get: () => store.getters[type],
      enumerable: true
    })
  })

  return gettersProxy
}

//注册mutation，将mutation存入store._mutations，传入的type为模块namespace+mutation的key值
//store._mutations[type]为数组，也就是说可以有多个key值相同的mutation
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    //这里的handler是我们自己写的mutation函数，
    //最终调用mutation的时候传入的是局部的state。
    //这是最终改变state的地方
    //我猜想没有传入全局state的原因是不想让我们利用局部的mutation改变全局的state
    //而把全局的state传入了action，这样就可以在action中拿到全局的state作为payload
    //传入mutation
    handler(local.state, payload)
  })
}

//注册action到store._actions，传入的type为模块的namespace+action的key值
//store._actions[type]为数组，也就是说可以有多个key值相同的action
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload, cb) {
    //这里的handler是我们自己写的action函数
    //可以看到传入了局部的dispatch,commit,getter,state,还有全局的getter和state
    let res = handler({
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)
    //如果action返回的结果不是Promise，也会包装成Promise，所以最后action返回的结果是Promsie
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

//注册getter，同样type是模块的namespace+getter的key值
function registerGetter (store, type, rawGetter, local) {
  //getter不是数组，是唯一的函数，action和mutation是数组
  //如果已经有了则return，说明注册getter的时候如果重名以前面的为准
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    //传给getter的四个参数
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

//
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `Do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

//根据path获取state状态，注册state树的时候用到
function getNestedState (state, path) {
  return path.length
    ? path.reduce((state, key) => state[key], state)
    : state
}

 //参数的适配处理 
//可以只传一个对象参数，对象中有type，对象本身是payload,第二个参数是options
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `Expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

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
