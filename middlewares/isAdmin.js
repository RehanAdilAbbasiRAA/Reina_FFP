isAdmin=(req, res, next) => {
    if(req.user){
        if(req.user.isAdmin === false){
            console.log('User is not an Admin')
            return res.redirect ('/auth/login')
        }
        else{
            console.log('User is Admin')
            next();
        }
    }
        else{
            console.log('User is Not Authenticated')
            return res.redirect ('/auth/login')

        }
    }
   

module.exports = isAdmin