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
