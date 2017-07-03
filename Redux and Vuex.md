## Redux and Vuex  源码分析与对比


### <h2 id="1">一 我们需要全局状态管理框架</h2>
   无论是Redux还是Vuex，都是为了管理全局的状态，因为随着应用的复杂，和组件化的划分，出现了很多组件之间的复杂数据交互，比如有全局的状态需要各组件之间共同维护和获取，各组件之间需要通信，在没有redux或者vuex之前，我们大都采用事件的方式进行组件之间的通信，但是事件写多了，不好查找，管理混乱, 或者传递属性的方式写起来比较麻烦。
   
   如果让我们写一个全局的状态管理，我们也能想到先有一个全局的状态对象，然后定义一个action对象，key是操作键值，value是操作state，然后再写一个dispatch方法，去调用action的方法。简单的写个基本思路如下：
      
   ```
function createStore(initialState = {}, actions) {
  let state = initialState
  let listeners = []
  function getState() {
    return state
  }

  function dispatch(type, payload) {
    let newState =  actions[type](state, payload)
    if(newState && newState != state) {
      listeners.forEach(func=>{
        func()
      })
    }
  }

  function subscribe(func) {
    listeners.push(func)
  }

  return {
    getState,
    dispatch,
    subscribe

  }
}

let store = createStore({sum: 1},{
  add: function (state, payload){
    return {
      sum: state.sum + payload
    }
  },
  reduce: function (state, payload){
    return {
      sum: state.sum - payload
    }
  }
})
   ```
   其实redux和vuex也就是在这个基础上，定义了一些状态管理的规范，使得代码结果清晰，各部分功能明确。
### <h2 id="2">二 Redux源码分析</h2>
具体的使用和概念参见Redux中文文档 http://cn.redux.js.org//index.html。本文从源码的角度进行分析。

#### <h3 id="2.1">2.1 redux源码的结构介绍</h3>

- index.js:源码的入口文件，集合导出其余5个文件的功能。
- createStore.js: 创建store对象的方法，接受reducer和initState。
- applyMiddle.js: 应用中间件的方法，该方法接受中间件数组，起到包装store的dispatch方法的作用，在action到达reducer之前可以做一些操作。
- combineReducers.js: 组合reducer的方法，将多个reducer组合成一个reducer，redux中对于state的划分就是利用reducer的划分， combineReducers方法将多个reducer合成一个reducer方法，也将多个reducer的state合成一个全局的state，每一个reducer只能操作自身的state。
- bindActionCreators.js: 提供了一个帮助方法，对actionCreator方法利用dispatch再进行一次包装，包装成的方法可以直接触发dispatch。

#### <h3 id="2.2"> 2.2 createStore.js文件</h3>
createStore.js文件提供了创建store的方法,下面只显示一些加了注释的关键代码部分。

- currentState: 内部的state对象
- currentReducer: 接受action的reducer对象
- currentListener: 存放监听函数的数组
- getState: 闭包方法获取内部的state
- subscribe: 提供订阅监听的方法
- dispatch: 接受action,将action传递给reducer，将返回值付给state，并且触发监听函数的方法
- replaceReducer: 替换reducer的方法。

```
export default function createStore(reducer, preloadedState, enhancer) {
  
  var currentReducer = reducer
  var currentState = preloadedState
  var currentListeners = []
  var nextListeners = currentListeners
  var isDispatching = false

  //获取state的方法
  function getState() {
    return currentState
  }

  function ensureCanMutateNextListeners() {
    if (nextListeners === currentListeners) {
      nextListeners = currentListeners.slice()
    }
  }
  //提供订阅监听的方法
  function subscribe(listener) {

    var isSubscribed = true

    ensureCanMutateNextListeners()
    nextListeners.push(listener)

    return function unsubscribe() {
      if (!isSubscribed) {
        return
      }

      isSubscribed = false

      ensureCanMutateNextListeners()
      var index = nextListeners.indexOf(listener)
      nextListeners.splice(index, 1)
    }
  }

  //将action和currentState传入currentReducer，并将返回值赋值给currentState
  function dispatch(action) {
    try {
      isDispatching = true
      currentState = currentReducer(currentState, action)
    } finally {
      isDispatching = false
    }

    //调用监听函数
    var listeners = currentListeners = nextListeners
    for (var i = 0; i < listeners.length; i++) {
      listeners[i]()
    }

    return action
  }

  //整体替换reduer
  function replaceReducer(nextReducer) {
    if (typeof nextReducer !== 'function') {
      throw new Error('Expected the nextReducer to be a function.')
    }

    currentReducer = nextReducer
    dispatch({ type: ActionTypes.INIT })
  }

 

  // When a store is created, an "INIT" action is dispatched so that every
  // reducer returns their initial state. This effectively populates
  // the initial state tree.
  dispatch({ type: ActionTypes.INIT })

  return {
    dispatch,
    subscribe,
    getState,
    replaceReducer,
    [$$observable]: observable
  }
}
```
#### <h3 id="2.3">2.3 combineReducers.js文件</h3>
提供了组合reducer的方法，将多个reducer组合成一个reducer，redux中对于state的划分就是利用reducer的划分， combineReducers方法将多个reducer合成一个reducer方法，也将多个reducer的state合成一个全局的state，每一个reducer只能操作自身的state。

- finalReducers: 最终的reducers对象
- finalReducerKeys: 最终的reducers的key值数组
- combination: 最终返回的组合的reducer方法

关键的combination代码中，可以得到几点心得：

- 1 每一个reducer只能拿到自己的子state
- 2 全局的state是由子state组成的，如果初始的state是空的话，那么只有在reducer被第一次调用的时候才会赋值
- 3 如果想改变state，因为是值比较，所以在reducer中需要返回新的state对象，同时如果全局的state变化，也会返回新的对象

```

//接受reduers对象，
export default function combineReducers(reducers) {
  var reducerKeys = Object.keys(reducers)
  var finalReducers = {}
  for (var i = 0; i < reducerKeys.length; i++) {
    var key = reducerKeys[i]

    if (typeof reducers[key] === 'function') {
      finalReducers[key] = reducers[key]
    }
  }
  var finalReducerKeys = Object.keys(finalReducers)

  //最后返回的组合reducer函数，接受初始的state和action
  return function combination(state = {}, action) {

    var hasChanged = false
    //新的全局state
    var nextState = {}
    //遍历每一个reducer
    for (var i = 0; i < finalReducerKeys.length; i++) {
      var key = finalReducerKeys[i]
      var reducer = finalReducers[key]
      //该reducer上的子state，如果创建store的时候没有传state，则是空的
      var previousStateForKey = state[key]
      //真正调用reducer函数返回state的地方
      //可以看到reducer中的state只是自己的state，不是全局的state
      var nextStateForKey = reducer(previousStateForKey, action)
      if (typeof nextStateForKey === 'undefined') {
        var errorMessage = getUndefinedStateErrorMessage(key, action)
        throw new Error(errorMessage)
      }
      //将返回的新state放入新的全局nextState
      nextState[key] = nextStateForKey
      //是否改变比较的是state的值，所以我们在写reducer的时候，如果需要改变state
      //应该返回一个新的对象，如果没有改变的话，应该返回传给reducer的旧state对象
      hasChanged = hasChanged || nextStateForKey !== previousStateForKey
    }
    //如果有一个子state变化，那么就返回新的state对象，这里也是返回的新对象nextState，而不是
    //在原来的state上进行修改
    return hasChanged ? nextState : state
  }
}

```
#### <h3 id="2.4">2.4 applyMiddleware.js文件</h3>

```
import compose from './compose'

/**
中间件的格式
({dispatch, getState}) =>{
	return next =>{
		return action =>{
		
		}
	}
}
 */
export default function applyMiddleware(...middlewares) {
  return (createStore) => (reducer, preloadedState, enhancer) => {
    //拿到store
    var store = createStore(reducer, preloadedState, enhancer)
    var dispatch = store.dispatch
    var chain = []

    var middlewareAPI = {
      getState: store.getState,
      //这里包一下dispatch的原因是，让传给中间件的dispatch是包装了中间件之后的dispatch，而不是原始的dispatch
      //如果写成dispatch:diapatch，那么当dispatch变化时，这里的dispatch还是原始的dispatch
      dispatch: (action) => dispatch(action) 
    }
    
    chain = middlewares.map(middleware => middleware(middlewareAPI))
    /*
      chain链中的元素格式
      next =>{
        return action =>{
        
        }
      }
    */

    //利用compose函数拿到包装了中间件的dispatch
    dispatch = compose(...chain)(store.dispatch) 

    return {
      ...store,
      dispatch
    }
  }
}

```

#### <h3 id="2.5">2.5 compose.js文件，提供了组合中间件的方法<h3>
 
 
 ```
 /**
 * compose函数最终返回的结果
 * (...args) => middle1(middle2(middle3(...args))).
 * 其中middle的格式
 * next =>{
      return action =>{
      
      }
    }
 */
export default function compose(...funcs) {
  if (funcs.length === 0) {
    return arg => arg
  }

  if (funcs.length === 1) {
    return funcs[0]
  }
  
  const last = funcs[funcs.length - 1]
  const rest = funcs.slice(0, -1)
  //从右向左递归调用
  return (...args) => rest.reduceRight((composed, f) => f(composed), last(...args))
}
 ```
#### <h3 id="2.6">2.6 bindActionCreators.js文件，提供了绑定actoinCreator的方法</h3>

```
//添加dispatch的方法
function bindActionCreator(actionCreator, dispatch) {
  //返回的函数，接受参数，传递给actionCreator调用，actionCreator返回标准的action，然后返回dispatch的结果
  return (...args) => dispatch(actionCreator(...args))
}

//将actionCreators绑定上dispatch，key还是actionCreators的key，但是多做了一层dispatch
export default function bindActionCreators(actionCreators, dispatch) {
  if (typeof actionCreators === 'function') {
    return bindActionCreator(actionCreators, dispatch)
  }

  if (typeof actionCreators !== 'object' || actionCreators === null) {
    throw new Error(
      `bindActionCreators expected an object or a function, instead received ${actionCreators === null ? 'null' : typeof actionCreators}. ` +
      `Did you write "import ActionCreators from" instead of "import * as ActionCreators from"?`
    )
  }

  var keys = Object.keys(actionCreators)
  var boundActionCreators = {}
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i]
    var actionCreator = actionCreators[key]
    if (typeof actionCreator === 'function') {
      boundActionCreators[key] = bindActionCreator(actionCreator, dispatch)
    }
  }
  return boundActionCreators
}

```
以上是Redux中6个文件的分析，下面就写一个简单的例子，看一下redux最基本的使用,理解下redux。
#### <h3 id="2.7">2.7 redux简单demo</h3>
store.js

```
import {createStore} from 'redux';
//创建action的方法
export function createAction(type, payload) {
	return {
		type,
		payload
	}
}
//初始的state
const initialState = {
	time: new Date().getTime()
}
//reducer函数
function reducer(state = initialState, action) {
	switch (action.type) {
		case 'NOW_TIME':
			return {
				...state,
				time: action.payload
			}
		default:
			return state;
	}
}

let store;
//获取store的方法
export function getStore() {
	if(store) return store;
	return store = createStore(reducer);
}

```
testRedux.js react-native的一段代码

```
'use strict';

import React, { Component } from 'react';

import {
  	StyleSheet,
  	View,
  	Text
} from 'react-native';
import MtButton from '@scfe/react-native-button';
import {getStore, createAction} from './store';
//获取到store
const store = getStore();
class TestRedux extends Component {
	constructor(props) {
	  	super(props);
		let state = store.getState();
	  	this.state = {
	  		time: state.time
	  	};
	  	//这里订阅state的变化，state变化之后拿到新的state，然后重新setState，更新视图
	  	store.subscribe(()=>{
	  		let state = store.getState();
	  		this.setState({
	  			time: state.time
	  		});
	  	});
	}
	//调用dispatch的方法
	_sendAction() {
		let action = createAction('NOW_TIME', new Date().getTime());
		store.dispatch(action);
	}
  	render() {
    	return (
      		<View style={styles.container}>
      			<Text>{this.state.time}
      			</Text>
				<MtButton text="发出action" onPress={this._sendAction.bind(this)} /> 
      		</View>
    	);
  	}
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		padding: 40
	}
});

export default TestRedux;
```
当然我们在实际生产中肯定不会这样用，还需要依赖react-redux、create-action等必要的模块，下面就继续看一下相关的模块。

###<h2 id="3">三 Redux相关库源码分析</h2>
####<h3 id="3.1">3.1 react-actions</h3>
react-actions提供了一种灵活的创建符合FSA标准action的方法,其中的`createAction.js`是我们生产中常用的文件,关键代码如下：

```
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = createAction;

var _identity = require('lodash/identity');

var _identity2 = _interopRequireDefault(_identity);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
/**
 * 
 * @param type  action中的type，String类型
 * @param payloadCreator  创建action中的payload的函数
 * @param metaCreator  创建action中的payload的函数
 */
function createAction(type, payloadCreator, metaCreator) {
  // _identity2.default 函数返回第一个参数
  var finalPayloadCreator = typeof payloadCreator === 'function' ? payloadCreator : _identity2.default;

  //调用createAction返回一个actionHandler函数，再调用actionHandler才返回action对象
  var actionHandler = function actionHandler() {
    var hasError = (arguments.length <= 0 ? undefined : arguments[0]) instanceof Error;

    //最终返回的action对象
    var action = {
      type: type
    };

    //如果在createAction中传payloadCreator和metaCreator函数，那么在actionHandler中传的参数将传递给
    //payloadCreator和metaCreator函数，并且将payloadCreator的返回结果当做action的payload，将metaCreator的返回结果当做action的meta
    var payload = hasError ? arguments.length <= 0 ? undefined : arguments[0] : finalPayloadCreator.apply(undefined, arguments);
    if (!(payload === null || payload === undefined)) {
      action.payload = payload;
    }

    if (hasError) {
      // Handle FSA errors where the payload is an Error object. Set error.
      action.error = true;
    }
    //将metaCreator的返回结果当做action的meta
    if (typeof metaCreator === 'function') {
      action.meta = metaCreator.apply(undefined, arguments);
    }
    //返回action
    return action;
  };

  actionHandler.toString = function () {
    return type.toString();
  };

  return actionHandler;
}
```
#### <h3 id="3.2">3.2 createAction方法使用实例</h3>
`types.js` 通常我们把action的type统一放在一起

```
export const GET_POI_INFO = 'GET_POI_INFO'
export const CHANGE_POI_STATUS = 'CHANGE_POI_STATUS'
```
`actions.js` actions.js用于调用createAction产生actionHandler。

```
import {createAction} from 'redux-actions';
import * as types from './actioins';
/**
 * 需要利用payloadCreator接收参数产生payload的action，这里payload返回的是一个Promise,
 * 接下来会讲到redux-promise中间件用于处理payload是promise的情况，
 * 实现了在createAction的时候能够处理异步产生action的情况
 * */
export const getPoiInfo = createAction(types.GET_POI_INFO, async(poiId)=> {
    return await poiService.getPoiInfo(poiId)
        .then(data=> {
            if (data == null) throw 'poi info is null';
            return data;
        });
});
//不需要利用payloadCreator产生payload的action
export const changePoiStatus = createAction(types.CHANGE_POI_STATUS);
```
#### <h3 id="3.3"> 3.3 redux-promise</h3>
redux-promise中间件是用于解决异步的action。

```
'use strict';

exports.__esModule = true;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

exports['default'] = promiseMiddleware;

var _fluxStandardAction = require('flux-standard-action');

function isPromise(val) {
  return val && typeof val.then === 'function';
}

//_ref接收的参数对象有两个 {getState,dispatch}
function promiseMiddleware(_ref) {
  var dispatch = _ref.dispatch;

  return function (next) {
    return function (action) {
      //如果不是标准的action
      if (!_fluxStandardAction.isFSA(action)) {
        //如果是action是promise，直接dispatch这个promise的结果，如果不是promise交给下一个中间件
        return isPromise(action) ? action.then(dispatch) : next(action);
      }
      //如果payload是promise，则把promise的结果作为这个action的payload，然后dispatch这个action
      //否则交给下一个中间件
      return isPromise(action.payload) ? action.payload.then(function (result) {
        return dispatch(_extends({}, action, { payload: result }));
      }, function (error) {
        return dispatch(_extends({}, action, { payload: error, error: true }));
      }) : next(action);
    };
  };
}

module.exports = exports['default'];

dispatch(new Promise(){
  resolve(action)
})

```
有了reduex-promise中间件以后我们就可以让action的payload是promise，然后promise的返回值是paylaod或者直接action就是一个promise，直接dispatch promise的返回值

#### <h3 id="3.4">3.4 react-redux</h3>

以上都是redux本身相关的库，react-redux是把redux更好的结合应用于react的库。
`index.js` 入口文件，向外提供了Provider和connect两个对象。

- Provider 是一个react的组件，接受store作为属性，然后放在context中，提供给子组件。我们把它作为根组件使用。

`Provider.js`

```
import { Component, PropTypes, Children } from 'react'
import storeShape from '../utils/storeShape'
import warning from '../utils/warning'


 //继承react的组件
export default class Provider extends Component {
  //利用context传递store，子组件在构造函数中可以通过context.store拿到store
  getChildContext() {
    return { store: this.store }
  }

  constructor(props, context) {
    super(props, context)
    this.store = props.store
  }
  //渲染唯一的子组件
  render() {
    const { children } = this.props
    return Children.only(children)
  }
}

if (process.env.NODE_ENV !== 'production') {
  Provider.prototype.componentWillReceiveProps = function (nextProps) {
    const { store } = this
    const { store: nextStore } = nextProps
    //store变化时给出警告
    if (store !== nextStore) {
      warnAboutReceivingStore()
    }
  }
}

```
- connect 方法实现将自定义将store中的state映射到组件的props上，把createAction方法包装成dispatch的方法挂在组件的props上，并且监听store中state的变化，更新组件的props。

`connect.js`

调用connect最终会返回包装的组件，在组件mounted的时候调用`trySubscribe`，订阅store中state的变化，在`handleChange`方法中通过`this.setState({ storeState })`触发重新渲染组件，在`render`中，调用

- updateStatePropsIfNeeded
- updateDispatchPropsIfNeeded
- updateMergedPropsIfNeeded

三个方法将更新最终的this.mergeProps
	

```
import { Component, createElement } from 'react'
import storeShape from '../utils/storeShape'
import shallowEqual from '../utils/shallowEqual'
import wrapActionCreators from '../utils/wrapActionCreators'
import warning from '../utils/warning'
import isPlainObject from 'lodash/isPlainObject'
import hoistStatics from 'hoist-non-react-statics'
import invariant from 'invariant'

const defaultMapStateToProps = state => ({}) // eslint-disable-line no-unused-vars
const defaultMapDispatchToProps = dispatch => ({ dispatch })
//更新属性 4
const defaultMergeProps = (stateProps, dispatchProps, parentProps) => ({
  ...parentProps,
  ...stateProps,
  ...dispatchProps
})


export default function connect(mapStateToProps, mapDispatchToProps, mergeProps, options = {}) {
  const shouldSubscribe = Boolean(mapStateToProps)
  const mapState = mapStateToProps || defaultMapStateToProps

  let mapDispatch
  if (typeof mapDispatchToProps === 'function') {
    mapDispatch = mapDispatchToProps
  } else if (!mapDispatchToProps) {
    mapDispatch = defaultMapDispatchToProps
  } else {
    mapDispatch = wrapActionCreators(mapDispatchToProps)
  }
//更新属性 3
  const finalMergeProps = mergeProps || defaultMergeProps
  const { pure = true, withRef = false } = options
  const checkMergedEquals = pure && finalMergeProps !== defaultMergeProps

  // Helps track hot reloading.
  const version = nextVersion++

  //connect函数返回的包装组件的方法
  return function wrapWithConnect(WrappedComponent) {
    const connectDisplayName = `Connect(${getDisplayName(WrappedComponent)})`

    function checkStateShape(props, methodName) {
      if (!isPlainObject(props)) {
        warning(
          `${methodName}() in ${connectDisplayName} must return a plain object. ` +
          `Instead received ${props}.`
        )
      }
    }

    //计算mergeProps
    function computeMergedProps(stateProps, dispatchProps, parentProps) {
      const mergedProps = finalMergeProps(stateProps, dispatchProps, parentProps)
      if (process.env.NODE_ENV !== 'production') {
        checkStateShape(mergedProps, 'mergeProps')
      }
      return mergedProps
    }

    class Connect extends Component {
      shouldComponentUpdate() {
        return !pure || this.haveOwnPropsChanged || this.hasStoreStateChanged
      }

      constructor(props, context) {
        super(props, context)
        this.version = version
        //获取store
        this.store = props.store || context.store

        invariant(this.store,
          `Could not find "store" in either the context or ` +
          `props of "${connectDisplayName}". ` +
          `Either wrap the root component in a <Provider>, ` +
          `or explicitly pass "store" as a prop to "${connectDisplayName}".`
        )

        const storeState = this.store.getState()
        this.state = { storeState }
        this.clearCache()
      }
       //计算stateProps
      computeStateProps(store, props) {
        if (!this.finalMapStateToProps) {
          return this.configureFinalMapState(store, props)
        }

        const state = store.getState()
        //获取state中的内容为props
        const stateProps = this.doStatePropsDependOnOwnProps ?
          this.finalMapStateToProps(state, props) :
          this.finalMapStateToProps(state)

        if (process.env.NODE_ENV !== 'production') {
          checkStateShape(stateProps, 'mapStateToProps')
        }
        return stateProps
      }

      configureFinalMapState(store, props) {
        const mappedState = mapState(store.getState(), props)
        const isFactory = typeof mappedState === 'function'

        this.finalMapStateToProps = isFactory ? mappedState : mapState
        this.doStatePropsDependOnOwnProps = this.finalMapStateToProps.length !== 1

        if (isFactory) {
          return this.computeStateProps(store, props)
        }

        if (process.env.NODE_ENV !== 'production') {
          checkStateShape(mappedState, 'mapStateToProps')
        }
        return mappedState
      }
      //计算dispatchProps
      computeDispatchProps(store, props) {
        if (!this.finalMapDispatchToProps) {
          return this.configureFinalMapDispatch(store, props)
        }

        const { dispatch } = store
        const dispatchProps = this.doDispatchPropsDependOnOwnProps ?
          this.finalMapDispatchToProps(dispatch, props) :
          this.finalMapDispatchToProps(dispatch)

        if (process.env.NODE_ENV !== 'production') {
          checkStateShape(dispatchProps, 'mapDispatchToProps')
        }
        return dispatchProps
      }

      configureFinalMapDispatch(store, props) {
        const mappedDispatch = mapDispatch(store.dispatch, props)
        const isFactory = typeof mappedDispatch === 'function'

        this.finalMapDispatchToProps = isFactory ? mappedDispatch : mapDispatch
        this.doDispatchPropsDependOnOwnProps = this.finalMapDispatchToProps.length !== 1

        if (isFactory) {
          return this.computeDispatchProps(store, props)
        }

        if (process.env.NODE_ENV !== 'production') {
          checkStateShape(mappedDispatch, 'mapDispatchToProps')
        }
        return mappedDispatch
      }

      //更新stateProps的地方
      updateStatePropsIfNeeded() {
        const nextStateProps = this.computeStateProps(this.store, this.props)
        if (this.stateProps && shallowEqual(nextStateProps, this.stateProps)) {
          return false
        }

        this.stateProps = nextStateProps
        return true
      }
      //更新dispatchProps的地方
      updateDispatchPropsIfNeeded() {
        const nextDispatchProps = this.computeDispatchProps(this.store, this.props)
        if (this.dispatchProps && shallowEqual(nextDispatchProps, this.dispatchProps)) {
          return false
        }

        this.dispatchProps = nextDispatchProps
        return true
      }

      //更新mergeProps的地方
      updateMergedPropsIfNeeded() {
        //mergeProps由 this.stateProps, this.dispatchProps, this.props 组成
        const nextMergedProps = computeMergedProps(this.stateProps, this.dispatchProps, this.props)
        if (this.mergedProps && checkMergedEquals && shallowEqual(nextMergedProps, this.mergedProps)) {
          return false
        }

        this.mergedProps = nextMergedProps
        return true
      }

      isSubscribed() {
        return typeof this.unsubscribe === 'function'
      }
      
      //订阅store中state的变化
      trySubscribe() {
        //
        if (shouldSubscribe && !this.unsubscribe) {
          //订阅store的state变化
          this.unsubscribe = this.store.subscribe(this.handleChange.bind(this))
          this.handleChange()
        }
      }

      tryUnsubscribe() {
        if (this.unsubscribe) {
          this.unsubscribe()
          this.unsubscribe = null
        }
      }

      componentDidMount() {
        ////订阅store的state变化
        this.trySubscribe()
      }

      componentWillReceiveProps(nextProps) {
        if (!pure || !shallowEqual(nextProps, this.props)) {
          this.haveOwnPropsChanged = true
        }
      }

      componentWillUnmount() {
        this.tryUnsubscribe()
        this.clearCache()
      }

      //store变化调用的方法
      handleChange() {
        if (!this.unsubscribe) {
          return
        }

        //reducer每次返回的state也是新的对象
        const storeState = this.store.getState()
        const prevStoreState = this.state.storeState
        if (pure && prevStoreState === storeState) {
          return
        }

        if (pure && !this.doStatePropsDependOnOwnProps) {
          const haveStatePropsChanged = tryCatch(this.updateStatePropsIfNeeded, this)
          if (!haveStatePropsChanged) {
            return
          }
          if (haveStatePropsChanged === errorObject) {
            this.statePropsPrecalculationError = errorObject.value
          }
          this.haveStatePropsBeenPrecalculated = true
        }

        this.hasStoreStateChanged = true
        //设置state重新渲染组件
        this.setState({ storeState })
      }

      

      render() {
        
        if (withRef) {
          // this.mergedProps  是最终给组件的属性
          this.renderedElement = createElement(WrappedComponent, {
            ...this.mergedProps,
            ref: 'wrappedInstance'
          })
        } else {
          // this.mergedProps  是最终给组件的属性
          this.renderedElement = createElement(WrappedComponent,
            this.mergedProps
          )
        }

        return this.renderedElement
      }
    }

    return hoistStatics(Connect, WrappedComponent)
  }
}

```
### <h2 id="4">四 Vuex源码分析</h2>
vuex是专门为Vue提供的全局状态管理框架，具体的概念和使用参见文档：https://vuex.vuejs.org/zh-cn/。这里对其关键源码进行分析。

`index.js`是入口文件，导出了6个关键方法。

```
import { Store, install } from './store'
import { mapState, mapMutations, mapGetters, mapActions } from './helpers'

export default {
  Store, //创建store对象的方法
  install, //安装vuex插件的方法
  version: '__VERSION__',
  mapState, //将store中的state映射到vue组件computed的方法
  mapMutations, //将store中的mutation映射到vue组件methods的方法
  mapGetters, //将store中的state映射到vue组件computed的方法
  mapActions //将store中的action映射到vue组件methods的方法
}
```
#### <h3 id="4.1">4.1 Vuex的装载</h3>
首先讲到install方法，我们安装vuex使用`Vue.use`方法，会将Vue传递给vuex的install方法并执行

```
import Vue from 'vue'
import Vuex from 'vuex'
Vue.use(Vuex)
```

但是如果在引入vuex之前已经将Vue挂在了window对象上的话，则不需要再调用Vue.use方法，相关源码如下:

`store.js`

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
install方法中调用了`applyMixin`方法，该方法在`mixin.js`文件中，其中如果Vue的版本大于等于2时，将`vuexInit `函数mixin到init或者beforeCreate生命周期函数中，1.x版本时，通过重写`Vue.prototype._init`方法，将`vuexInit`函数放在_init的options中，_init方法在Vue的构造函数中会调用。所以在每一个vue实例创建的时候都会调用vuexInit方法。

`mixin.js`

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
```

再看一下`vuexInit`方法，将store对象挂在每一个vue实例的`$store`属性上。

```
/**
   * Vuex init hook, injected into each instances init hooks list.
   * 初始化Vue根组件时传入的store设置到this.$store属性上，
   * 子组件从其父组件引用$store属性，层层嵌套进行设置。
   * 在任意组件中执行 this.$store 都能找到装载的那个store对象
   */

  function vuexInit () {
    const options = this.$options
    // store injection
    if (options.store) {
      //根组件
      this.$store = options.store
      //子组件
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
```
#### <h3 id="4.2">4.2 Store构造函数</h3>
安装了Vuex之后，我们将利用`Store`方法创建store对象，示例如下：

```
const moduleA = {
  state: { ... },
  mutations: { ... },
  actions: { ... },
  getters: { ... }
}

const moduleB = {
  state: { ... },
  mutations: { ... },
  actions: { ... }
}

const store = new Vuex.Store({
  modules: {
    a: moduleA,
    b: moduleB
  }
})
```
那么下面就看看`Store`方法的构造函数中都做了什么事情。

- 声明变量
 - this._committing 标识是否利用commit改变state
 - this._actions 存放所有模块的action，其中key值已经加上命名空间
 - this._mutations  存放所有模块的mutation，其中key值已经加上命名空间
 - this._wrappedGetters 存放所有模块的getter，其中key值已经加上命名空间
 - this._modules 存放模块树
 - this._modulesNamespaceMap 存放有命名空间的模块与命名空间之间的map
 - this._subscribers 存放订阅state变化的函数
 - this._watcherVM 提供一个VM用于监听state和getter的变化
 - this.dispatch 绑定this为store的dispatch
 - this.commit 绑定this为store的dispatch
 - state 用于存放所有模块state树的`rootState`
 - installModule   安装模块的方法
 - resetStoreVM 设置store._vm
 - plugins.forEach安装插件

具体代码如下：

```
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
```

#### <h3 id="4.3">4.3 Store的模块树和命名空间</h3>
在构造函数中我们可以看到，开始处理options参数的是这行代码

```
this._modules = new ModuleCollection(options)
```
它就是根据我们传入的store参数去构造store模块树。

关于store的模块化和命名空间参见文档：https://vuex.vuejs.org/zh-cn/modules.html

概括起来包括以下几点：

- Vuex的store可以分模块，模块可以添加命名空间，添加了命名空间的模块有局部的上下文。
- 传给mutation的是局部的state。
- 传给action的是局部和全局的state和getter。
- 传给getter的是局部和全局的state和getter。
- 默认的commit和dispatch都是分发局部的mutation和action。
- 若需要在全局命名空间内分发 action 或提交 mutation，将 { root: true } 作为第三参数传给 dispatch 或 commit 即可

对于模块树的构造，我们首先需要看一下模块节点的构造函数`module/module.js`

- this._rawModule 存放原始的模块对象
- this.state 指向`this._rawModule.state`或者是`this._rawModule.state()`
- this._children 存放子模块
- addChild,removeChild,getChild 添加，删除和获取子模块
- forEachChild，forEachGetter，forEachAction，forEachMutation分别提供
遍历这几种元素的方法
- update 提供更新rawModule的方法
- namespaced 判断模块是否有命名空间

```
import { forEachValue } from '../util'

export default class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    //存放子模块
    this._children = Object.create(null)
    //存放原始的模块对象
    this._rawModule = rawModule
    const rawState = rawModule.state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }
	//判断模块是否有命名空间
  get namespaced () {
    return !!this._rawModule.namespaced
  }

  addChild (key, module) {
    this._children[key] = module
  }

  removeChild (key) {
    delete this._children[key]
  }

  getChild (key) {
    return this._children[key]
  }

  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }

  forEachChild (fn) {
    forEachValue(this._children, fn)
  }

  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}

```
再看一下模块树的构造函数`module/module-collection.js`，

- this.root，指向模块树的根模块
- register，根据path和参数，构造模块，并且根据path挂载到root指向的模块树上，然后遍历参数的modules对象，递归调用register。
- unregister，根据path从模块树上卸载模块
- update,递归更新整个模块树
- get 根据path从模块树上获取module，例如path为['a']，获取到a的module
- getNamespace 获取模块树上某一个模块的命名空间

**注意：**
模块的命名空间只与模块设置的namespaced属性有关。没有设置namespaced属性的模块它的命名空间还是全局的。


```
import Module from './module'
import { assert, forEachValue } from '../util'

export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    this.register([], rawRootModule, false)
  }

  //根据path从模块树上获取module，例如path为['a']，获取到a的module
  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }
  //获取模块树上某一个模块的命名空间，如果所有模块的namespaced都为true，那么得到的命名空间就和path相同
  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }
  //递归更新整个模块树
  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }


  /**
   *根据path和参数，构造模块，并且根据path挂载到root
   *指向的模块树上，然后遍参数的modules对象，递归调用register。
   */
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
  //根据path从模块树上卸载模块
  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    if (!parent.getChild(key).runtime) return

    parent.removeChild(key)
  }
}

function update (path, targetModule, newModule) {
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, newModule)
  }

  // update target module
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}

function assertRawModule (path, rawModule) {
  ['getters', 'actions', 'mutations'].forEach(key => {
    if (!rawModule[key]) return

    forEachValue(rawModule[key], (value, type) => {
      assert(
        typeof value === 'function',
        makeAssertionMessage(path, key, type, value)
      )
    })
  })
}

function makeAssertionMessage (path, key, type, value) {
  let buf = `${key} should be function but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`

  return buf
}

```
#### <h3 id="4.4">4.4 模块的安装</h3>
上一节中，讲到了将构造的模块树存到了`this._modules`中，接下来开始遍历模块树进行安装

```
installModule(this, state, [], this._modules.root)
```
`installModule`方法做了如下几件事情：

 - 如果模块有命名空间，将对应关系存入store._modulesNamespaceMap中
 - 调用`store._withCommit`设置模块的state到state树上
 - 创建模块的局部上下文 local
 - 循环注册模块的mutation、action和getter到	store._mutations、store._actions和store._wrappedGetters中
 - 遍历模块的子模块递归安装
 
具体代码如下：

```
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
```
模块的命名空间体现在了模块注册的的各个部分，首先是局部上下文的创建

```
const local = module.context = makeLocalContext(store, namespace, path)
```
上下文包括了四个部分

 - dispatch方法，如果命名空间是空字符串，则直接返回store.dispatch,如果有命名空间，并且调用dispath的时候第三个参数options.root！=true的情况下，就会在调用store.dispatch的时候type加上命名空间，这样就只调用命名空间下的action。
 - commit方法，与dispatch方法同理
 - getters对象，从从store.getters中筛选命名空间下的getters
 - state对象，根据path从store.state中找模块对应的state

如果没有命名空间的话，那么全局的上下文就是store中的这四个元素。

具体`makeLocalContext`方法如下：

```
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
```
其中还用到了如下方法：

`makeLocalGetters`方法

```

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
```
`unifyObjectStyle`方法用于dispatch和commit方法参数的适配处理

```
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
```
`getNestedState`方法

```
//根据path获取state状态，注册state树的时候用到
function getNestedState (state, path) {
  return path.length
    ? path.reduce((state, key) => state[key], state)
    : state
}
```

创建了上下文以后，就开始注册mutation、action、和getter。

注册mutaion的方法，可以看到

- store._mutations[type]为数组，也就是说可以有多个key值相同的mutation
- 只传给mutation的是local.state，即不建议利用mutation操作命名空间之外的state
- 我们是直接在我们写的mutation中改变state，而不需要像redux中写reducer那样要返回一个新的对象，才能够触发订阅state变化的事件
- store.state是get，不能直接修改，而local.state是从state对象上找的指针，所以可以向直接操作Vue中定义的data一样直接操作改变，而能触发响应。

```
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
```
注册action的方法

- 可以看到将上下文中的四项都传给了它，而且还传了store的getters和state，所以在action中可以调用store中的任何state和getters来触发该命名空间下和全局的action和mutation，复杂的组合逻辑都可以写到action函数中。
- 还可以看到store._actions中的函数返回的肯定都是Promise

```
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
```
注册getter的方法

 - 注册getter的时候如果重名以前面的为准
 - getter也都可以利用全局的state和getter来组合

```
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
```

至此，模块的安装就告一段落，经历了installModule之后，Store的`_actions`,`_mutations`,`_wrappedGetters`,还有内部的`state`就都拥有了内容。

#### <h3 id="4.5">4.5 设置Store的VM对象</h3>
在构造函数中调用如下：

```
resetStoreVM(this, state)
```

`resetStoreVM`方法

 - 设置`store._vm`为VM，其中将内部变量state作为data，将store._wrappedGetters作为计算属性，利用了VM的双向绑定和计算属性的缓存
 - 设置`store.getters`，指向`store._vm`的计算属性，利用它的缓存
 - 清空旧VM的数据并销毁

```
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
```
最终对外的`store.state`是通过getter来访问`store._vm._data.$$state`,实现了只读的效果。

```
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
```
#### <h3 id="4.6">4.6 commit and dispatch方法 </h3>
`commit`方法是`store`对象对外提供的执行mutation的方法

 - 根据`type`从`this._mutations`中找到mutation并依次执行
 - 遍历执行`this._subscribers`触发订阅state变化的函数

```
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
 ```
 在执行mutation改变state的时候调用了`_withCommit`方法,它的作用是执行改变state的时候，保证`store._committing === true`。在`resetStoreVM`时，如果是设置了严格模式`store.strict == true`,则调用`enableStrictMode`方法，利用`store._vm`
的`watch`方法，监听state的变化，如果变化，则判断`store._committing === true`,如果不是则发出警告不要利用mutation之外的方法改变state。
 
 ```
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
 ```
 
 ```
 function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `Do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}
```
 
`dispatch`方法是`store`对象对外提供的执行action的方法，返回值是promise

```
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
```
#### <h3 id="4.7">4.7 订阅变化的方法 </h3>
`store`提供了两个订阅state变化的方法，一个是`subscribe`，一个是`watch`。

`subscribe`方法将订阅函数放在`store._subscribers`中，用于监听state的变化，其实是监听`commit`方法的执行，在上一节的`commit`代码中可以看到，只要执行`commit`方法就触发`store._subscribers`中函数的执行。

```
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
```
`watch`方法用来订阅我们对于`store.state`和`store.getters`自定义属性的变化，利用了`store._watcherVM.$watch`方法

```
  watch (getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }
```
